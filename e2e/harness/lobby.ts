import type { Page, WebSocketRoute } from '@playwright/test';
import type { CreateRoomRequest, CreateRoomResponse, RoomSummary } from '../../src/lib/mp/protocol.ts';
import { LOBBY_WS_PATH, SESSION_TTL_MS } from '../../src/lib/mp/rules.ts';
import type { Clock } from './clock.ts';

/** 목록에 쓰는 방 요약 한 줄. 지정하지 않은 값은 대기 중인 경쟁 단판 6자. */
export function summary(code: string, host: string, patch: Partial<RoomSummary> = {}): RoomSummary {
	return {
		code,
		host,
		kind: 'comp',
		game: 'single',
		players: 1,
		max: 5,
		inProgress: false,
		length: 6,
		tries: 6,
		hard: false,
		timer: false,
		updatedAt: 0,
		...patch
	};
}

/**
 * 로비 서버: GET /api/rooms, GET /api/room/<코드>, POST /api/room과 목록 구독 소켓(LOBBY_WS_PATH).
 * rooms를 바꾸고 pushRooms()를 부르면 구독 중인 페이지에 목록이 밀려간다.
 */
export class FakeLobby {
	rooms: RoomSummary[];
	/** POST /api/room이 받은 요청. */
	readonly created: CreateRoomRequest[] = [];
	/** 다음 방 만들기가 돌려줄 코드. */
	nextCode = 'NEW234';
	readonly polls = { rooms: 0 };
	/** true면 구독 소켓을 바로 끊는다(폴백 폴링 시나리오). */
	refuseSocket = false;
	private sockets: WebSocketRoute[] = [];

	private constructor(
		private readonly clock: Clock,
		rooms: RoomSummary[]
	) {
		this.rooms = rooms;
	}

	static async create(page: Page, clock: Clock, rooms: RoomSummary[] = []): Promise<FakeLobby> {
		const lobby = new FakeLobby(clock, rooms);
		await page.route('**/api/rooms', (route) => {
			lobby.polls.rooms++;
			return route.fulfill({ json: lobby.rooms });
		});
		await page.route('**/api/room/*', (route) => {
			const code = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
			const found = lobby.rooms.find((r) => r.code === code);
			return found ? route.fulfill({ json: found }) : route.fulfill({ status: 404, body: 'not found' });
		});
		await page.route('**/api/room', (route) => {
			const req = route.request().postDataJSON() as CreateRoomRequest;
			lobby.created.push(req);
			const res: CreateRoomResponse = { code: lobby.nextCode, session: { token: 'tok-me', exp: lobby.clock.now + SESSION_TTL_MS } };
			return route.fulfill({ json: res });
		});
		await page.routeWebSocket(new RegExp(`${LOBBY_WS_PATH}$`), (ws) => {
			if (lobby.refuseSocket) return ws.close({ code: 1006 });
			lobby.sockets.push(ws);
			ws.onMessage((raw) => raw === 'ping' && ws.send('pong'));
			ws.send(JSON.stringify(lobby.rooms));
		});
		return lobby;
	}

	pushRooms(rooms: RoomSummary[] = this.rooms): void {
		this.rooms = rooms;
		for (const ws of this.sockets) ws.send(JSON.stringify(rooms));
	}

	dropSockets(code = 1006): void {
		for (const ws of this.sockets) ws.close({ code });
		this.sockets = [];
	}
}
