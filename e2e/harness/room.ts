import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import { CLOSE } from '../../src/lib/mp/protocol.ts';
import type { ChatMsg, ClientMsg, Pid, ServerMsg, SessionInfo, Settings, Snapshot } from '../../src/lib/mp/protocol.ts';
import { DEFAULT_SETTINGS, NAME_BAD_CHARS, normalizeName, SESSION_TTL_MS } from '../../src/lib/mp/rules.ts';
import { ChatLog, historyMsg, planChat } from '../../src/lib/server/mp/chat.ts';
import { isClimb, stageLengths } from '../../src/lib/server/mp/climb.ts';
import type { Start } from '../../src/lib/server/mp/climb.ts';
import { chooseStartN } from '../../src/lib/server/mp/comp.ts';
import * as coop from '../../src/lib/server/mp/coop.ts';
import * as members from '../../src/lib/server/mp/members.ts';
import { parseClientMsg } from '../../src/lib/server/mp/parse.ts';
import { reduce } from '../../src/lib/server/mp/reduce.ts';
import type { Effect, Io } from '../../src/lib/server/mp/reduce.ts';
import { personalize } from '../../src/lib/server/mp/snapshot.ts';
import { initRoom } from '../../src/lib/server/mp/state.ts';
import type { RoomState } from '../../src/lib/server/mp/state.ts';
import { tick } from '../../src/lib/server/mp/timers.ts';
import type { Clock } from './clock.ts';
import { seed } from './storage.ts';
import { answerOf, WORD_BY_N, type Answer } from './words.ts';

export interface RoomOptions {
	code?: string;
	settings?: Partial<Settings>;
	/** 내 닉네임. 서버와 같은 규칙으로 5~12자여야 한다. */
	name?: string;
	/** true면 내가 방장이다. 아니면 others의 첫 사람이 방장. */
	host?: boolean;
	/** 나보다 먼저 들어와 있는 사람(입장 순). */
	others?: string[];
	/** others 중 준비를 마친 사람. */
	ready?: string[];
	/** 시작 때 서버가 D1에서 읽는 n자 정답. 기본은 words.ts의 표. */
	answer?: (n: number) => Answer;
	/** 추측·제안이 사전에 있는지. 기본은 전부 있음. */
	valid?: (jamo: string) => boolean;
}

const UID_ME = 'uid-me';
const TOKEN_ME = 'tok-me';

/** 시드 고정 난수. rng(max)는 [0, max) 정수. 돌림판·무작위 길이가 매번 같게 나온다. */
function seeded(seed: number): (max: number) => number {
	let a = seed;
	return (max) => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
	};
}

/**
 * 방 서버(Room DO) 한 채를 브라우저 소켓 뒤에 세운 것. 규칙은 서버가 쓰는 순수 함수(reduce, personalize, tick, ChatLog)를 그대로 돌리고,
 * DO 셸이 맡는 소켓·저장·D1만 이 클래스가 흉내 낸다. 그래서 스냅샷 모양과 개인화(남의 보드 가리기)는 서버와 같다.
 * 클라이언트가 보낸 메시지는 서버의 parseClientMsg로 검사하고 sent에 쌓는다.
 */
export class FakeRoom {
	readonly code: string;
	readonly state: RoomState;
	/** 클라이언트가 보낸 메시지(hello·ping 제외). */
	readonly sent: ClientMsg[] = [];
	readonly hellos: { token?: string; name: string }[] = [];
	/** parseClientMsg가 거절한 원문. 하나라도 있으면 클라이언트가 프로토콜을 어긴 것이다. */
	readonly invalid: string[] = [];
	/** 코드가 있으면 새 소켓을 그 코드로 바로 닫는다(재접속 실패·방 없음·가득 참 시나리오). */
	refuse: number | null = null;
	valid: (jamo: string) => boolean;

	private readonly rng = seeded(7);
	private readonly chat = new ChatLog();
	private readonly answerFor: (n: number) => Answer;
	private readonly myName: string;
	private ws: WebSocketRoute | null = null;
	private myPid: Pid | null = null;
	private sessionPending = true;

	private constructor(
		private readonly page: Page,
		readonly clock: Clock,
		opts: RoomOptions
	) {
		this.code = opts.code ?? 'ABC234';
		this.myName = opts.name ?? '테스트유저';
		this.valid = opts.valid ?? (() => true);
		this.answerFor = opts.answer ?? ((n) => answerOf(WORD_BY_N[n]));
		const now = clock.now;
		const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
		const others = opts.others ?? [];
		const host = opts.host ?? others.length === 0;
		// 방장 자리는 만든 사람이 예약한다. 내가 방장이면 hello가 올 때까지 비워 두고, 아니면 첫 사람이 먼저 접속한다.
		const creator = host ? { uid: UID_ME, name: this.myName } : { uid: `uid-${others[0]}`, name: others[0] };
		this.state = initRoom(this.code, creator, settings, now, this.rng);
		if (!host) members.join(this.state, creator, now, this.rng);
		for (const name of others.slice(host ? 0 : 1)) members.join(this.state, { uid: `uid-${name}`, name }, now, this.rng);
		for (const name of opts.ready ?? []) members.setReady(this.state, this.pid(name), true);
	}

	static async create(page: Page, clock: Clock, opts: RoomOptions = {}): Promise<FakeRoom> {
		const room = new FakeRoom(page, clock, opts);
		await page.routeWebSocket(new RegExp(`/ws/${room.code}$`), (ws) => room.accept(ws));
		return room;
	}

	/** 초대 링크로 들어간다. 저장된 닉네임이 있으면 닉네임 모달 없이 바로 소켓을 연다. */
	async enter(): Promise<void> {
		await seed(this.page, { 'mp-session': { name: this.myName } });
		await this.page.goto(`/?room=${this.code}`);
	}

	/** 링크로 들어가 첫 스냅샷까지 받는다. */
	async open(): Promise<void> {
		await this.enter();
		await this.connected();
	}

	/** 소켓이 열려 첫 스냅샷까지 받을 때까지. */
	async connected(): Promise<void> {
		await expect.poll(() => this.myPid !== null && !this.sessionPending, { message: '첫 스냅샷' }).toBe(true);
	}

	pid(name: string): Pid {
		const p = this.state.players.find((q) => q.name === name);
		if (!p) throw new Error(`방에 ${name}이 없습니다`);
		return p.pid;
	}

	/** 내 pid. hello 전에는 없다. */
	get me(): Pid {
		if (!this.myPid) throw new Error('아직 hello 전입니다');
		return this.myPid;
	}

	snapshot(): Snapshot {
		return personalize(this.state, this.me, this.clock.now);
	}

	// ---- 소켓 ----

	private accept(ws: WebSocketRoute): void {
		if (this.refuse !== null) {
			void ws.close({ code: this.refuse });
			return;
		}
		this.ws = ws;
		ws.onMessage((raw) => {
			if (typeof raw !== 'string') return;
			if (raw === 'ping') return ws.send('pong');
			const msg = parseClientMsg(raw);
			if (!msg) {
				this.invalid.push(raw);
				return;
			}
			if (msg.type === 'hello') this.hello(ws, msg.token, msg.name);
			else this.fromMe(ws, msg);
		});
	}

	private send(msg: ServerMsg, to: WebSocketRoute | null = this.ws): void {
		to?.send(JSON.stringify(msg));
	}

	private hello(ws: WebSocketRoute, token: string | undefined, rawName: string): void {
		this.hellos.push({ token, name: rawName });
		const name = normalizeName(rawName);
		if (!name) {
			this.send({ type: 'error', code: 'forbidden', msg: NAME_BAD_CHARS }, ws);
			void ws.close({ code: 1008 });
			return;
		}
		const r = members.join(this.state, { uid: UID_ME, name }, this.clock.now, this.rng);
		if (!r.ok) {
			void ws.close({ code: r.reason === 'full' ? CLOSE.FULL : CLOSE.IN_PROGRESS });
			return;
		}
		this.myPid = r.pid;
		coop.advance(this.state, this.rng, this.clock.now);
		this.state.seq++;
		this.send({ type: 'welcome', pid: r.pid, name: r.name }, ws);
		this.send(historyMsg(this.chat), ws);
		const session: SessionInfo = { token: TOKEN_ME, exp: this.clock.now + SESSION_TTL_MS };
		this.send({ type: 'snap', snap: personalize(this.state, r.pid, this.clock.now), session }, ws);
		this.sessionPending = false;
	}

	private fromMe(ws: WebSocketRoute, msg: ClientMsg): void {
		this.sent.push(msg);
		if (msg.type === 'chat') {
			const peers = [{ ws, pid: this.myPid, open: true }];
			for (const { to, msg: out } of planChat(this.chat, this.state, { ws, pid: this.me }, msg.text, this.clock.now, peers)) this.send(out, to);
			return;
		}
		this.apply(this.me, msg);
	}

	/** DO의 act()와 같은 순서: reduce, 이벤트 전달, 바뀌었으면 seq를 올리고 방송. */
	private apply(pid: Pid, msg: ClientMsg): void {
		const io: Io = {};
		if (msg.type === 'guess' || msg.type === 'propose') io.valid = this.valid(msg.jamo);
		if (msg.type === 'start') io.start = this.startFor();
		const r = reduce(this.state, pid, msg, io, this.clock.now, this.rng);
		this.deliver(r.events);
		if (r.changed) this.broadcast(!r.skipSave);
	}

	private deliver(events: Effect[]): void {
		for (const e of events) {
			if (e.type === 'drop') {
				if (e.pid === this.myPid) this.ws?.close({ code: 1000 });
				continue;
			}
			if (e.to !== this.myPid) continue;
			if (e.type === 'error') this.send({ type: 'error', code: e.code, msg: e.msg });
			else if (e.type === 'nudge') this.send({ type: 'nudge', from: e.from });
			else this.send({ type: 'opensettings' });
		}
	}

	private broadcast(bumpSeq = true): void {
		if (bumpSeq) this.state.seq++;
		if (this.myPid && members.findPlayer(this.state, this.myPid)?.connected) {
			this.send({ type: 'snap', snap: personalize(this.state, this.myPid, this.clock.now) });
		}
	}

	private startFor(): Start {
		const n = chooseStartN(this.state.settings, this.rng);
		const answer = this.answerFor(n);
		if (!isClimb(this.state.settings)) return { n, answer };
		const stages = Object.fromEntries(stageLengths(n).map((k) => [k, this.answerFor(k)]));
		return { n, answer, stages };
	}

	// ---- 테스트가 서버 쪽에서 일으키는 일 ----

	/** state를 직접 고친 뒤 새 스냅샷을 내보낸다. */
	push(): void {
		this.broadcast();
	}

	/** 다른 참가자가 보낸 메시지를 서버 규칙대로 처리한다. */
	as(name: string): { send: (msg: ClientMsg) => void } {
		return { send: (msg) => this.apply(this.pid(name), msg) };
	}

	join(name: string): void {
		const r = members.join(this.state, { uid: `uid-${name}`, name }, this.clock.now, this.rng);
		if (!r.ok) throw new Error(`입장 실패: ${r.reason}`);
		this.broadcast();
	}

	disconnect(name: string): void {
		members.disconnect(this.state, this.pid(name), this.clock.now);
		coop.advance(this.state, this.rng, this.clock.now);
		this.broadcast();
	}

	reconnect(name: string): void {
		members.join(this.state, { uid: `uid-${name}`, name }, this.clock.now, this.rng);
		coop.advance(this.state, this.rng, this.clock.now);
		this.broadcast();
	}

	/** 방장 외 접속자 전원이 준비하고 방장이 시작한다. */
	startGame(): void {
		const host = this.state.hostPid!;
		for (const p of this.state.players) if (p.pid !== host && p.connected) members.setReady(this.state, p.pid, true);
		this.apply(host, { type: 'start' });
	}

	/** 다른 참가자의 채팅. 속도 제한은 서버와 같은 ChatLog가 센다. */
	say(name: string, text: string): void {
		const r = this.chat.post(this.state, this.pid(name), text, this.clock.now);
		if (!r.ok) throw new Error(r.msg);
		this.send({ type: 'chat', msg: r.msg });
	}

	/** 방 안 대화 기록에 미리 넣어 둔다(입장 직후 chat_history로 간다). */
	seedChat(name: string, text: string, at = this.clock.now): ChatMsg {
		const r = this.chat.post(this.state, this.pid(name), text, at);
		if (!r.ok) throw new Error(r.msg);
		return r.msg;
	}

	/** 내 소켓이 비정상으로 끊긴다. 서버는 나를 끊김 처리한다. */
	dropMe(code = 1006): void {
		members.disconnect(this.state, this.me, this.clock.now);
		this.ws?.close({ code });
	}

	/** 서버가 정한 코드로 내 소켓을 닫는다(방 없음·가득 참·다른 탭 등). */
	closeMe(code: number): void {
		this.ws?.close({ code });
	}

	/**
	 * 시간이 흐른다. 페이지의 시계와 서버 시각이 같이 움직이고, 서버는 만료된 마감(투표·제한 시간·유예)을 처리해 바뀐 게 있으면 새 스냅샷을 보낸다.
	 * 서버 알람은 마감 시각마다 울리지만 여기서는 끝 시각에 한 번 처리한다. 마감 사이에 일어나는 중간 상태가 필요하면 나눠서 부른다.
	 */
	async advance(ms: number, how: 'run' | 'jump' = 'run'): Promise<void> {
		await (how === 'run' ? this.clock.run(ms) : this.clock.jump(ms));
		const t = tick(this.state, this.clock.now, this.rng);
		if (t.changed) this.broadcast();
	}

	// ---- 검사 ----

	sentOf<T extends ClientMsg['type']>(type: T): Extract<ClientMsg, { type: T }>[] {
		return this.sent.filter((m): m is Extract<ClientMsg, { type: T }> => m.type === type);
	}

	/** type 메시지가 n개째 도착할 때까지 기다려 가장 최근 것을 돌려준다. */
	async nextSent<T extends ClientMsg['type']>(type: T, n = 1): Promise<Extract<ClientMsg, { type: T }>> {
		await expect.poll(() => this.sentOf(type).length, { message: `${type} 메시지` }).toBeGreaterThanOrEqual(n);
		return this.sentOf(type)[n - 1];
	}
}
