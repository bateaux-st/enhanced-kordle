import { DurableObject } from 'cloudflare:workers';
import { CLOSE } from '../../mp/protocol.ts';
import type { ClientMsg, ServerMsg, SessionInfo, Settings, RoomSummary } from '../../mp/protocol.ts';
import { LOBBY_REFRESH_MS, normalizeName } from '../../mp/rules.ts';
import { dict } from '../dict.ts';
import { randomIndex } from '../token.ts';
import { isClimb, stageLengths } from './climb.ts';
import { chooseStartN } from './comp.ts';
import * as coop from './coop.ts';
import type { Lobby } from './lobby.ts';
import * as members from './members.ts';
import { parseClientMsg } from './parse.ts';
import { reduce } from './reduce.ts';
import type { Effect, Io } from './reduce.ts';
import { isListed, sameSummary, summarize } from './rooms.ts';
import { mpSecret } from './secret.ts';
import { refresh } from './session.ts';
import { personalize } from './snapshot.ts';
import { initRoom } from './state.ts';
import type { Pid, RoomState } from './state.ts';
import { alarmChange, alarmTarget, isStaleSocket, reapCheckAt, tick } from './timers.ts';

/** 멀티 정답 풀 임계값. 개인용 POOL_THRESHOLD와 무관한 별도 상수다(설계 §3). */
const MP_POOL_T = 3;
const STATE_KEY = 'state';
const OPEN = 1;

interface RoomEnv {
	DB: D1Database;
	KORDLE_SECRET?: string;
	LOBBY: DurableObjectNamespace<Lobby>;
}

/** 소켓 첨부. hello 전이거나 자리를 잃은 소켓은 null. */
interface Att {
	pid: Pid | null;
	uid: string | null;
	/** 접속 시각. 자동 응답이 한 번도 없는 소켓의 무응답 기준이다. */
	at?: number;
}

const attOf = (ws: WebSocket): Att => (ws.deserializeAttachment() as Att | null) ?? { pid: null, uid: null };

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
	try {
		ws.close(code, reason);
	} catch {
		/* 이미 닫힌 소켓 */
	}
}

/**
 * 방 하나 = DO 하나. IO 셸만 맡고 규칙은 순수 모듈(reduce, members, comp, ...)에 있다.
 * 모든 변경은 run()을 지난다: tick -> 변경 -> (바뀌었으면) 저장 1회 + 브로드캐스트 -> Lobby 동기화 -> 알람.
 */
export class Room extends DurableObject<RoomEnv> {
	private state: RoomState | null = null;
	private alarmAt: number | null = null;
	private lastSummary: RoomSummary | null = null;
	private lastUpsert = 0;
	/** 무응답 소켓을 마지막으로 점검한 시각. */
	private lastReap = Date.now();
	/** Lobby 목록에 올라가 있다고 알고 있는지. */
	private listed = false;
	/** hello 직후 첫 snap에만 session을 싣는다. */
	private pendingSession = new WeakMap<WebSocket, SessionInfo>();

	constructor(ctx: DurableObjectState, env: RoomEnv) {
		super(ctx, env);
		// 자동 응답은 DO를 깨우지 않는다.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
		ctx.blockConcurrencyWhile(async () => {
			this.state = (await ctx.storage.get<RoomState>(STATE_KEY)) ?? null;
			this.alarmAt = await ctx.storage.getAlarm();
			// 깨어났을 때는 직전에 올렸는지 모르므로 올라가 있다고 보고, 첫 동기화에서 필요하면 한 번 지운다.
			this.listed = this.state !== null;
			await this.reconcileSockets();
		});
	}

	/** 재시작·축출 뒤에는 저장된 connected를 믿지 않고 첨부 pid가 있는 열린 소켓과 맞춘다. 정상 접속자는 소켓이 있어 그대로다. */
	private async reconcileSockets(): Promise<void> {
		const s = this.state;
		if (!s) return;
		const now = Date.now();
		const live = this.ctx.getWebSockets().flatMap((ws) => attOf(ws).pid ?? []);
		// 축출 중에 지나간 마감이 advance보다 먼저 반영되어야 한다.
		const t = tick(s, now);
		if (!members.reconcile(s, live, now) && !t.changed) return;
		coop.advance(s, randomIndex, now);
		s.seq++;
		await this.ctx.storage.put(STATE_KEY, s);
		// 알람이 마감 때문에 DO를 깨웠다면 만료는 여기서 반영되어 뒤이은 alarm()의 run은 바뀐 게 없다. 알리지 않으면 접속자가 결과를 못 받는다.
		this.broadcast(s, now);
		this.syncLobby(s, now);
		await this.updateAlarm(s, now);
	}

	// ---- Worker에서 부르는 RPC (외부에서는 닿지 않는다) ----

	/** 방 생성 예약. 이미 초기화된 방이면 false(호출자가 새 코드로 재시도). */
	async init(code: string, creator: { uid: string; name: string }, settings: Settings): Promise<boolean> {
		if (this.state) return false;
		const now = Date.now();
		const s = initRoom(code, creator, settings, now, randomIndex);
		this.state = s;
		await this.ctx.storage.put(STATE_KEY, s);
		this.syncLobby(s, now);
		await this.updateAlarm(s, now);
		return true;
	}

	async info(): Promise<RoomSummary | null> {
		return this.state ? summarize(this.state, Date.now()) : null;
	}

	// ---- WebSocket ----

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ pid: null, uid: null, at: Date.now() } satisfies Att);
		// 없는 방은 첫 메시지(hello)에서 4004로 닫는다. 핸드셰이크 응답 전에 닫으면 클라이언트에 닫기 코드가 가지 않는다.
		// 어느 쪽이든 아무것도 저장하지 않는다(아무 코드로 저장 공간이 생기지 않게).
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== 'string') return;
		if (!this.state) return void closeQuietly(ws, CLOSE.NO_ROOM, 'no room');
		const msg = parseClientMsg(message);
		if (!msg) return this.sendTo(ws, { type: 'error', code: 'forbidden', msg: '잘못된 요청입니다' });

		const att = attOf(ws);
		if (msg.type === 'hello') {
			if (att.pid) return this.sendTo(ws, { type: 'error', code: 'forbidden', msg: '이미 입장했습니다' });
			return this.hello(ws, msg.token, msg.name);
		}
		if (!att.pid) return this.sendTo(ws, { type: 'error', code: 'forbidden', msg: '먼저 입장해야 합니다' });
		return this.act(ws, att.pid, msg);
	}

	async webSocketClose(ws: WebSocket, code: number): Promise<void> {
		await this.gone(ws);
		// 1005/1006은 close()에 쓸 수 없는 예약 코드라 정상 종료로 돌려 닫는다.
		closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, 'closed');
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.gone(ws);
	}

	async alarm(): Promise<void> {
		this.alarmAt = null;
		const stale = this.reapStale(Date.now());
		await this.run(
			stale.length
				? (s, now) => {
						// 닫은 소켓의 webSocketClose는 상대가 응답하지 않으면 오지 않으므로 여기서 끊김으로 처리한다.
						for (const pid of stale) if (!this.socketsOf(pid).length) members.disconnect(s, pid, now);
						coop.advance(s, randomIndex, now);
						return { changed: true };
					}
				: undefined
		);
	}

	/** 마지막 자동 응답(없으면 접속 시각)이 45초 넘은 소켓을 닫는다. 자리를 잃는 pid 목록을 돌려준다. */
	private reapStale(now: number): Pid[] {
		this.lastReap = now;
		const pids = new Set<Pid>();
		for (const ws of this.ctx.getWebSockets()) {
			const att = attOf(ws);
			const seenAt = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? att.at;
			if (seenAt === undefined || !isStaleSocket(seenAt, now)) continue;
			if (att.pid) pids.add(att.pid);
			ws.serializeAttachment({ pid: null, uid: null } satisfies Att);
			closeQuietly(ws, 1001, 'stale');
		}
		return [...pids];
	}

	// ---- 메시지 처리 ----

	private async hello(ws: WebSocket, token: string | undefined, rawName: string): Promise<void> {
		const name = normalizeName(rawName);
		if (!name) {
			this.sendTo(ws, { type: 'error', code: 'forbidden', msg: '닉네임은 5~12자여야 합니다' });
			return closeQuietly(ws, 1008, 'bad name');
		}
		const session = await refresh(token, name, Date.now(), mpSecret(this.env.KORDLE_SECRET));
		await this.run((s, now) => {
			const r = members.join(s, { uid: session.uid, name }, now, randomIndex);
			if (!r.ok) {
				closeQuietly(ws, r.reason === 'full' ? CLOSE.FULL : CLOSE.IN_PROGRESS, r.reason);
				return { changed: false };
			}
			// 같은 uid의 기존 소켓(새로고침, 다른 탭)은 자리를 넘기고 4000으로 닫는다.
			for (const other of this.ctx.getWebSockets()) {
				if (other === ws || attOf(other).uid !== session.uid) continue;
				other.serializeAttachment({ pid: null, uid: null } satisfies Att);
				closeQuietly(other, CLOSE.REPLACED, 'replaced');
			}
			// 이미 제안한 사람이 돌아오면 "접속 중 전원 제안"이 채워질 수 있다.
			coop.advance(s, randomIndex, now);
			ws.serializeAttachment({ pid: r.pid, uid: session.uid, at: attOf(ws).at } satisfies Att);
			this.pendingSession.set(ws, { token: session.token, exp: session.exp });
			this.sendTo(ws, { type: 'welcome', pid: r.pid, name: r.name });
			return { changed: true };
		});
		if (!this.state) closeQuietly(ws, CLOSE.NO_ROOM, 'no room');
	}

	private async act(ws: WebSocket, pid: Pid, msg: ClientMsg): Promise<void> {
		if (!this.state || !members.findPlayer(this.state, pid)) return closeQuietly(ws, CLOSE.NO_ROOM, 'no seat');
		// D1은 await 사이에 다른 메시지가 끼어들 수 있으므로 조회를 먼저 하고, 적용(reduce)은 동기 구간에서 다시 검증한다.
		const io: Io = {};
		if (msg.type === 'guess' || msg.type === 'propose') io.valid = await this.lookupValid(pid, msg.type, msg.jamo);
		else if (msg.type === 'start') io.start = await this.lookupStart(pid);
		await this.run((s, now) => {
			const r = reduce(s, pid, msg, io, now, randomIndex);
			this.deliver(r.events);
			return { changed: r.changed, skipSave: r.skipSave, destroy: r.destroy };
		});
	}

	/** 제출할 수 있는 상태일 때만 D1을 읽는다(그 밖에는 reduce가 D1 없이 거절한다). 실패하면 undefined. */
	private async lookupValid(pid: Pid, type: 'guess' | 'propose', jamo: string): Promise<boolean | undefined> {
		const s = this.state;
		if (!s || s.phase !== 'playing') return undefined;
		const game = s.game;
		let n: number | undefined;
		if (type === 'guess' && game?.kind === 'comp' && game.players[pid]?.status === 'playing') n = game.players[pid].board.n;
		else if (type === 'propose' && game?.kind === 'coop' && game.status === 'playing' && game.step.kind === 'propose' && coop.seated(s, pid)) n = game.board.n;
		if (n === undefined || [...jamo].length !== n) return undefined;
		try {
			return await dict(this.env.DB).isValidJamo(jamo);
		} catch {
			return undefined;
		}
	}

	/**
	 * 시작 길이를 정하고 정답을 풀에서 읽는다(길이마다 pool_meta 1행 + pool 1행).
	 * 등반은 12자까지 모든 스테이지를 시작 때 읽어 두어 진행 중 순수 로직이 D1을 부르지 않게 한다(최대 16행). 실패하면 undefined.
	 */
	private async lookupStart(pid: Pid): Promise<Io['start']> {
		const s = this.state;
		if (!s || s.hostPid !== pid || !members.canStart(s).ok) return undefined;
		const n = chooseStartN(s.settings, randomIndex);
		const lengths = isClimb(s.settings) ? stageLengths(n) : [n];
		try {
			const d = dict(this.env.DB);
			const answers = await Promise.all(
				lengths.map(async (k) => {
					const count = await d.answerCount(MP_POOL_T, k);
					if (count <= 0) throw new Error(`pool empty n=${k}`);
					return [k, await d.answerAt(MP_POOL_T, k, randomIndex(count))] as const;
				})
			);
			const stages = Object.fromEntries(answers);
			return { n, answer: stages[n], ...(lengths.length > 1 ? { stages } : {}) };
		} catch {
			return undefined;
		}
	}

	private deliver(events: Effect[]): void {
		for (const e of events) {
			if (e.type === 'error') this.sendToPid(e.to, { type: 'error', code: e.code, msg: e.msg });
			else if (e.type === 'nudge') this.sendToPid(e.to, { type: 'nudge', from: e.from });
			else if (e.type === 'open_settings') this.sendToPid(e.to, { type: 'opensettings' });
			else {
				for (const ws of this.ctx.getWebSockets()) {
					if (attOf(ws).pid !== e.pid) continue;
					ws.serializeAttachment({ pid: null, uid: null } satisfies Att);
					closeQuietly(ws, 1000, 'left');
				}
			}
		}
	}

	/** 소켓이 사라졌다. 같은 자리에 열린 다른 소켓이 있으면(탭 넘겨받기 직후) 끊김이 아니다. */
	private async gone(ws: WebSocket): Promise<void> {
		const { pid } = attOf(ws);
		if (!pid || !this.state) return;
		if (this.socketsOf(pid).some((w) => w !== ws)) return;
		await this.run((s, now) => {
			members.disconnect(s, pid, now);
			// 끊긴 사람이 마지막 미제안·미투표자였다면 기다리지 않고 진행한다.
			coop.advance(s, randomIndex, now);
			return { changed: true };
		});
	}

	// ---- 변경 공통 경로 ----

	private async run(fn?: (s: RoomState, now: number) => { changed: boolean; skipSave?: boolean; destroy?: boolean }): Promise<void> {
		const s = this.state;
		if (!s) return;
		const now = Date.now();
		const t = tick(s, now);
		let changed = t.changed;
		let save = t.changed;
		let destroy = t.destroy;
		if (!destroy && fn) {
			const r = fn(s, now);
			changed ||= r.changed;
			save ||= r.changed && !r.skipSave;
			destroy = r.destroy ?? false;
		}
		if (destroy) return this.destroy(s);

		if (changed) {
			// 초안만 바뀐 경우는 저장하지 않고 seq도 올리지 않는다: 올리면 재시작 뒤 저장된 seq가 클라이언트가 본 값보다 낮아져
			// 클라이언트가 한동안 스냅샷을 낡았다고 버린다. 클라이언트는 같은 seq를 받아들인다.
			if (save) {
				s.seq++;
				// 상태는 작아서(5명 x 10행 x 12자) 바뀐 메시지마다 통째로 1회만 쓴다.
				await this.ctx.storage.put(STATE_KEY, s);
			}
			this.broadcast(s, now);
		}
		this.syncLobby(s, now);
		await this.updateAlarm(s, now);
	}

	private broadcast(s: RoomState, now: number): void {
		for (const ws of this.ctx.getWebSockets()) {
			const { pid } = attOf(ws);
			if (!pid || ws.readyState !== OPEN) continue;
			const session = this.pendingSession.get(ws);
			this.pendingSession.delete(ws);
			this.sendTo(ws, { type: 'snap', snap: personalize(s, pid, now), ...(session ? { session } : {}) });
		}
	}

	private sendTo(ws: WebSocket, msg: ServerMsg): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			/* 보내는 사이 닫힌 소켓 */
		}
	}

	private socketsOf(pid: Pid): WebSocket[] {
		return this.ctx.getWebSockets().filter((ws) => attOf(ws).pid === pid && ws.readyState === OPEN);
	}

	private sendToPid(pid: Pid, msg: ServerMsg): void {
		for (const ws of this.socketsOf(pid)) this.sendTo(ws, msg);
	}

	// ---- Lobby, 알람, 소멸 ----

	private lobby() {
		return this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
	}

	/** 요약(접속 인원·방장·종류·phase)이 바뀌었거나 오래 알리지 않았을 때만 Lobby를 부른다. 접속자가 없으면 목록에서 뺀다. */
	private syncLobby(s: RoomState, now: number): void {
		if (!isListed(s)) {
			if (!this.listed) return;
			this.listed = false;
			this.lastSummary = null;
			this.lobby()
				.remove(s.code)
				.catch(() => {
					this.listed = true; // 다음 동기화에서 다시 지운다
				});
			return;
		}
		this.listed = true;
		const sum = summarize(s, now);
		const due = now - this.lastUpsert >= LOBBY_REFRESH_MS;
		if (!due && this.lastSummary && sameSummary(sum, this.lastSummary)) return;
		this.lastSummary = sum;
		this.lastUpsert = now;
		this.lobby()
			.upsert(sum)
			.catch(() => {
				this.lastSummary = null; // 다음 변경 때 다시 시도
			});
	}

	/** 알람은 가장 이른 마감 하나(빈 방·방장 유예·제한 시간 등), Lobby 재알림, 소켓 정리 점검 중 이른 것. 값이 바뀔 때만 쓴다. */
	private async updateAlarm(s: RoomState, now: number): Promise<void> {
		const target = alarmTarget(s, this.lastUpsert, reapCheckAt(this.lastReap, this.ctx.getWebSockets().length));
		const change = alarmChange(this.alarmAt, target, now);
		if (change === 'keep') return;
		if (change === 'delete') {
			this.alarmAt = null;
			await this.ctx.storage.deleteAlarm();
		} else {
			this.alarmAt = change;
			await this.ctx.storage.setAlarm(change);
		}
	}

	private async destroy(s: RoomState): Promise<void> {
		this.state = null;
		for (const ws of this.ctx.getWebSockets()) {
			ws.serializeAttachment({ pid: null, uid: null } satisfies Att);
			closeQuietly(ws, CLOSE.DESTROYED, 'room closed');
		}
		this.lobby()
			.remove(s.code)
			.catch(() => {});
		this.alarmAt = null;
		this.lastSummary = null;
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}
}
