import { DurableObject } from 'cloudflare:workers';
import type { RoomSummary } from '../../mp/protocol.ts';
import { listRooms, nextStaleAt, sameList } from './rooms.ts';
import { alarmChange } from './timers.ts';

const KEY = 'rooms';
const SHOWN_KEY = 'shown';
const OPEN = 1;

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
	try {
		ws.close(code, reason);
	} catch {
		/* 이미 닫힌 소켓 */
	}
}

/**
 * 공개 방 목록 싱글턴. Room의 호출은 DO RPC, 목록 화면은 WebSocket 구독이다.
 * 항목 하나가 바뀔 때마다 저장 키 하나를 통째로 쓴다. 구독자가 없으면 푸시·알람 비용은 0이다.
 */
export class Lobby extends DurableObject<object> {
	private rooms: Record<string, RoomSummary> = {};
	/** 구독자에게 마지막으로 보낸 목록. 하이버네이션으로 메모리가 비어도 심장박동마다 다시 보내지 않게 저장해 둔다. */
	private shown: RoomSummary[] | null = null;
	private alarmAt: number | null = null;

	constructor(ctx: DurableObjectState, env: object) {
		super(ctx, env);
		// 자동 응답은 DO를 깨우지 않는다.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
		ctx.blockConcurrencyWhile(async () => {
			const stored = await ctx.storage.get<Record<string, RoomSummary> | RoomSummary[]>([KEY, SHOWN_KEY]);
			this.rooms = (stored.get(KEY) as Record<string, RoomSummary> | undefined) ?? {};
			this.shown = (stored.get(SHOWN_KEY) as RoomSummary[] | undefined) ?? null;
			this.alarmAt = await ctx.storage.getAlarm();
		});
	}

	/** 입장 가능한 방 먼저, 최신순, 최대 50개. 오래 갱신되지 않은 방은 이때 정리한다. */
	async list(): Promise<RoomSummary[]> {
		const list = await this.currentList();
		await this.push(list);
		return list;
	}

	async upsert(summary: RoomSummary): Promise<void> {
		this.rooms[summary.code] = { ...summary, updatedAt: Date.now() };
		await this.ctx.storage.put(KEY, this.rooms);
		await this.notify();
	}

	async remove(code: string): Promise<void> {
		if (!(code in this.rooms)) return;
		delete this.rooms[code];
		await this.ctx.storage.put(KEY, this.rooms);
		await this.notify();
	}

	// ---- 목록 구독 WebSocket ----

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		const list = await this.currentList();
		// 새 소켓은 현재 목록을 한 번 받는다. 다른 구독자와 어긋나 있었다면 함께 맞춘다.
		if (!(await this.push(list))) this.send(server, list);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(): Promise<void> {
		// 클라이언트가 보낼 것은 'ping'뿐이고 그건 자동 응답이 처리한다.
	}

	async webSocketClose(ws: WebSocket, code: number): Promise<void> {
		// 1005/1006은 close()에 쓸 수 없는 예약 코드라 정상 종료로 돌려 닫는다.
		closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, 'closed');
		await this.idleCheck(ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.idleCheck(ws);
	}

	async alarm(): Promise<void> {
		this.alarmAt = null;
		await this.notify();
	}

	// ---- 푸시 ----

	private subscribers(except?: WebSocket): WebSocket[] {
		return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.readyState === OPEN);
	}

	private async currentList(): Promise<RoomSummary[]> {
		const { list, pruned } = listRooms(this.rooms, Date.now());
		if (pruned) await this.ctx.storage.put(KEY, this.rooms);
		return list;
	}

	/** 구독자가 있을 때만 목록을 다시 계산해 보낸다. */
	private async notify(): Promise<void> {
		if (!this.subscribers().length) return;
		await this.push(await this.currentList());
	}

	/** 직전에 보낸 것과 다를 때만 구독자 전부에게 보낸다. 보냈으면 true. 구독자가 있으면 만료 알람도 다시 맞춘다. */
	private async push(list: RoomSummary[]): Promise<boolean> {
		const subs = this.subscribers();
		if (!subs.length) return false;
		const changed = !this.shown || !sameList(this.shown, list);
		if (changed) {
			this.shown = list;
			await this.ctx.storage.put(SHOWN_KEY, list);
			for (const ws of subs) this.send(ws, list);
		}
		await this.updateAlarm();
		return changed;
	}

	private send(ws: WebSocket, list: RoomSummary[]): void {
		try {
			ws.send(JSON.stringify(list));
		} catch {
			/* 보내는 사이 닫힌 소켓 */
		}
	}

	/** 시간만 지나도 목록에서 빠지는 방이 있으니 구독자가 있는 동안 가장 이른 만료 시각에 깨운다. */
	private async updateAlarm(): Promise<void> {
		const change = alarmChange(this.alarmAt, nextStaleAt(this.rooms), Date.now());
		if (change === 'keep') return;
		if (change === 'delete') {
			this.alarmAt = null;
			await this.ctx.storage.deleteAlarm();
		} else {
			this.alarmAt = change;
			await this.ctx.storage.setAlarm(change);
		}
	}

	/** 마지막 구독자가 나가면 알람을 지워 빈 로비가 혼자 깨지 않게 한다. */
	private async idleCheck(closing: WebSocket): Promise<void> {
		if (this.subscribers(closing).length || this.alarmAt === null) return;
		this.alarmAt = null;
		await this.ctx.storage.deleteAlarm();
	}
}
