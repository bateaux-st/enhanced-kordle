// Room·Lobby DO를 workerd 없이 Node에서 만들어 보는 가짜 런타임. .test.mjs가 아니라서 테스트로 실행되지 않는다.
// 이 파일을 import한 뒤에 room.ts·lobby.ts를 동적 import해야 한다(정적 import는 링크 단계에서 cloudflare:workers를 먼저 푼다).
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { issue } from '../src/lib/server/mp/session.ts';
import './loader.mjs';
import { T0 } from './mp-helpers.mjs';

export { T0 };

const OPEN = 1;
const CLOSED = 3;
// workerd의 close()는 예약 코드를 던진다. Room이 1005/1006을 1000으로 돌려 닫는지 보려면 같은 제약이 있어야 한다.
const RESERVED_CLOSE = new Set([1004, 1005, 1006, 1015]);

export class FakeSocket {
	readyState = OPEN;
	attachment = null;
	/** 서버가 보낸 메시지(JSON을 푼 값). take()로 비운다. */
	sent = [];
	/** 성공한 close() 호출. */
	closes = [];

	send(data) {
		if (this.readyState !== OPEN) throw new TypeError('닫힌 소켓에 보냈다');
		this.sent.push(JSON.parse(data));
	}

	close(code, reason) {
		if (code !== undefined && (RESERVED_CLOSE.has(code) || code < 1000 || code > 4999)) throw new TypeError(`Invalid close code ${code}`);
		// compat 2026-04-07 이후 close 이벤트 안의 close()는 조용히 무시된다.
		if (this.readyState !== OPEN) return;
		this.closes.push({ code, reason });
		this.readyState = CLOSED;
	}

	serializeAttachment(value) {
		const copy = structuredClone(value);
		assert.ok(JSON.stringify(copy).length <= 2048, '첨부는 2KB를 넘을 수 없다');
		this.attachment = copy;
	}

	deserializeAttachment() {
		return this.attachment === null ? null : structuredClone(this.attachment);
	}

	/** 지금까지 받은 메시지를 돌려주고 비운다. */
	take() {
		return this.sent.splice(0);
	}

	/** 서버가 처음 닫은 기록. 안 닫았으면 null. */
	get closed() {
		return this.closes[0] ?? null;
	}
}

// Node의 Response는 101을 거부한다. Room.fetch가 돌려주는 모양(status, webSocket)만 있으면 된다.
class FakeResponse {
	constructor(body = null, init = {}) {
		this.body = body;
		this.status = init.status ?? 200;
		this.webSocket = init.webSocket ?? null;
	}

	async text() {
		return String(this.body ?? '');
	}
}

class FakeWebSocketPair {
	constructor() {
		this[0] = new FakeSocket();
		this[1] = new FakeSocket();
	}
}

class FakeAutoResponsePair {
	constructor(request, response) {
		this.request = request;
		this.response = response;
	}
}

// Response는 rig·lobbyRig를 쓸 때만 바꾼다. dict·라우트 시험은 진짜 Response(json())가 필요하다.
const installResponse = () => Object.defineProperty(globalThis, 'Response', { value: FakeResponse, configurable: true, writable: true });
globalThis.WebSocketPair = FakeWebSocketPair;
globalThis.WebSocketRequestResponsePair = FakeAutoResponsePair;

/** DO 저장소. 값은 복사해 넣고 꺼내므로 인스턴스가 객체를 공유해 생기는 착시가 없다. */
export class FakeStorage {
	data = new Map();
	alarm = null;
	/** 쓰기·알람 호출 기록. 읽기는 남기지 않는다. */
	ops = [];

	async get(keys) {
		if (!Array.isArray(keys)) return this.data.has(keys) ? structuredClone(this.data.get(keys)) : undefined;
		return new Map(keys.filter((k) => this.data.has(k)).map((k) => [k, structuredClone(this.data.get(k))]));
	}

	async put(key, value) {
		this.ops.push({ op: 'put', key });
		this.data.set(key, structuredClone(value));
	}

	// compat 2026-02-24부터 delete_all_deletes_alarm이 기본이라 deleteAll이 알람도 지운다(SQLite DO 포함).
	async deleteAll() {
		this.ops.push({ op: 'deleteAll' });
		this.data.clear();
		this.alarm = null;
	}

	async getAlarm() {
		return this.alarm;
	}

	async setAlarm(at) {
		this.ops.push({ op: 'setAlarm', at: Number(at) });
		this.alarm = Number(at);
	}

	async deleteAlarm() {
		this.ops.push({ op: 'deleteAlarm' });
		this.alarm = null;
	}

	/** 특정 키에 쓴 횟수. */
	puts(key) {
		return this.ops.filter((o) => o.op === 'put' && o.key === key).length;
	}
}

/** 하이버네이션을 가로질러 남는 것: 저장소와 소켓. 인스턴스(메모리 필드)만 새로 만든다. */
export class FakeCtx {
	storage = new FakeStorage();
	sockets = [];
	autoResponse = null;
	blocked = [];
	pings = new Map();

	acceptWebSocket(ws) {
		this.sockets.push(ws);
	}

	getWebSockets() {
		return [...this.sockets];
	}

	setWebSocketAutoResponse(pair) {
		this.autoResponse = pair;
	}

	getWebSocketAutoResponseTimestamp(ws) {
		return this.pings.get(ws) ?? null;
	}

	blockConcurrencyWhile(fn) {
		const p = fn();
		this.blocked.push(p);
		return p;
	}

	/** 클라이언트의 'ping'에 런타임이 자동으로 답한 시각을 지금으로 한다. */
	ping(ws) {
		this.pings.set(ws, new Date(Date.now()));
	}

	/** close 이벤트까지 전달된 소켓을 목록에서 뺀다. */
	release(ws) {
		this.sockets = this.sockets.filter((w) => w !== ws);
	}
}

const SQL = {
	valid: 'SELECT 1 FROM valid WHERE jamo = ?',
	count: 'SELECT count FROM pool_meta WHERE t = ? AND n = ?',
	at: 'SELECT word, jamo FROM pool WHERE t = ? AND n = ? AND idx = ?'
};

/**
 * dict.ts가 쓰는 세 SQL만 받는 D1. 다른 SQL은 던지고 unexpected에도 남긴다(셸이 던짐을 삼키므로 rig가 끝에서 비었는지 본다).
 * pool은 `${t}:${n}` -> [{word, jamo}]. 키가 없으면 pool_meta 행이 없다.
 */
export class FakeD1 {
	queries = [];
	unexpected = [];
	/** Error를 넣으면 이후 모든 조회가 그 오류로 실패한다. */
	failWith = null;
	/** Promise를 넣으면 조회가 그것이 풀릴 때까지 기다린다. */
	gate = null;

	constructor({ valid = [], pool = {} } = {}) {
		this.valid = new Set(valid);
		this.pool = pool;
	}

	prepare(sql) {
		if (!Object.values(SQL).includes(sql)) {
			this.unexpected.push(sql);
			throw new Error(`예상 밖 SQL: ${sql}`);
		}
		return {
			bind: (...args) => ({
				first: async () => {
					this.queries.push({ sql, args });
					if (this.gate) await this.gate;
					if (this.failWith) throw this.failWith;
					return this.row(sql, args);
				}
			})
		};
	}

	row(sql, args) {
		if (sql === SQL.valid) return this.valid.has(args[0]) ? { 1: 1 } : null;
		const rows = this.pool[`${args[0]}:${args[1]}`];
		if (sql === SQL.count) return rows ? { count: rows.length } : null;
		return rows?.[args[2]] ?? null;
	}

	/** 조회 종류별 횟수. */
	count(kind) {
		return this.queries.filter((q) => q.sql === SQL[kind]).length;
	}
}

/** Room이 부르는 LOBBY 네임스페이스 대역. target을 주면 실제 Lobby 인스턴스로 넘긴다. */
export function fakeLobbyNs(target) {
	const lobby = {
		calls: [],
		names: [],
		/** 메서드 이름 -> Error. 있으면 그 호출이 거절된다. */
		fail: {},
		/** 메서드 이름 -> Promise. 있으면 풀릴 때까지 호출이 끝나지 않는다. */
		gate: {},
		upserts: () => lobby.calls.filter((c) => c.method === 'upsert').map((c) => c.arg),
		removes: () => lobby.calls.filter((c) => c.method === 'remove').map((c) => c.arg)
	};
	const call = async (method, arg) => {
		lobby.calls.push({ method, arg: structuredClone(arg) });
		if (lobby.gate[method]) await lobby.gate[method];
		if (lobby.fail[method]) throw lobby.fail[method];
		return target?.[method](arg);
	};
	const stub = { upsert: (s) => call('upsert', s), remove: (c) => call('remove', c) };
	lobby.ns = {
		idFromName(name) {
			lobby.names.push(name);
			return { name };
		},
		get: () => stub
	};
	return lobby;
}

/** 이벤트 루프를 한 바퀴 돌려 Room이 기다리지 않고 붙여 둔 then·catch를 마저 실행시킨다. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));

const WS_REQUEST = () => new Request('https://kordle.test/ws/ABC234', { headers: { Upgrade: 'websocket' } });

export const NAMES = ['가나다라마', '바사아자차', '카타파하거', '너더러머버', '서어저처커', '터퍼허고노'];

/**
 * Room 하나를 가짜 런타임에 올린다. 시간은 Date만 mock해서 t.mock.timers로 움직인다.
 * pool·valid는 FakeD1에 그대로 넘어간다.
 */
export async function rig(t, { secret = 'test-secret', pool = {}, valid = [], lobbyTarget, now = T0 } = {}) {
	installResponse();
	t.mock.timers.enable({ apis: ['Date'], now });
	const { Room } = await import('../src/lib/server/mp/room.ts');
	const ctx = new FakeCtx();
	const db = new FakeD1({ pool, valid });
	const lobby = fakeLobbyNs(lobbyTarget);
	const env = { DB: db, LOBBY: lobby.ns, KORDLE_SECRET: secret };
	t.after(() => assert.deepEqual(db.unexpected, [], 'D1에 예상 밖 SQL이 왔다'));

	const r = { Room, ctx, db, lobby, env, secret };

	const ready = async () => {
		await Promise.all(ctx.blocked);
	};
	const boot = async () => {
		r.room = new Room(ctx, env);
		await ready();
		return r.room;
	};
	await boot();

	r.revive = boot;
	r.settle = settle;
	r.advance = (ms) => t.mock.timers.tick(ms);
	r.at = (ms) => t.mock.timers.setTime(ms);
	r.state = () => ctx.storage.data.get('state');
	r.alarmAt = () => ctx.storage.alarm;

	/** 방을 만든다. 생성자 uid는 방장의 hello 토큰과 같아야 자리가 이어진다. */
	r.create = async (settings = {}, creator) => {
		return r.room.init('ABC234', creator, { ...DEFAULT_SETTINGS, ...settings });
	};

	r.connect = async () => {
		await ready();
		const res = await r.room.fetch(WS_REQUEST());
		assert.equal(res.status, 101);
		return ctx.sockets.at(-1);
	};

	r.send = async (ws, msg) => {
		await ready();
		await r.room.webSocketMessage(ws, typeof msg === 'string' ? msg : JSON.stringify(msg));
	};

	/** 연결하고 hello까지 보낸다. 돌려주는 값에 받은 메시지(msgs)와 발급된 세션이 있다. */
	r.hello = async (name, token) => {
		const ws = await r.connect();
		await r.send(ws, { type: 'hello', name, ...(token ? { token } : {}) });
		const msgs = ws.take();
		const welcome = msgs.find((m) => m.type === 'welcome');
		const snap = msgs.find((m) => m.type === 'snap');
		return { ws, msgs, name: welcome?.name, pid: welcome?.pid, session: snap?.session };
	};

	/** 방장 토큰을 먼저 발급해 init하고 방장이 입장한 상태. */
	r.open = async (settings = {}, name = NAMES[0]) => {
		const session = await issue(undefined, name, Date.now(), secret);
		await r.create(settings, { uid: session.uid, name });
		return r.hello(name, session.token);
	};

	/** 방장이 연 방에 names가 입장하고 준비까지 마친 상태. 방장이 첫 원소다. */
	r.players = async (names = NAMES.slice(1, 2), settings = {}) => {
		const host = await r.open(settings);
		const guests = [];
		for (const name of names) {
			const g = await r.hello(name);
			await r.send(g.ws, { type: 'ready', on: true });
			guests.push(g);
		}
		for (const p of [host, ...guests]) p.ws.take();
		return [host, ...guests];
	};

	/** 클라이언트가 소켓을 닫은 것으로 본다. web_socket_auto_reply_to_close 아래서는 런타임이 답장 Close를 이미 보내 close 이벤트 시점에 CLOSED다. */
	r.drop = async (ws, code = 1001) => {
		await ready();
		ws.readyState = CLOSED;
		await r.room.webSocketClose(ws, code);
		ctx.release(ws);
	};

	/** 걸려 있는 알람 시각까지 시계를 보내고 alarm()을 부른다(stay면 시계를 두고 부른다). 걸린 알람이 없으면 던진다. */
	r.fireAlarm = async ({ stay = false } = {}) => {
		const at = ctx.storage.alarm;
		assert.notEqual(at, null, '걸린 알람이 없다');
		if (!stay && at > Date.now()) t.mock.timers.setTime(at);
		ctx.storage.alarm = null;
		await ready();
		await r.room.alarm();
		await settle();
		return at;
	};

	return r;
}

/** 소켓 하나가 받은 메시지 중 type이 맞는 것. */
export const ofType = (msgs, type) => msgs.filter((m) => m.type === type);

/** Lobby 하나를 가짜 런타임에 올린다. 구독 소켓의 받은 목록은 ws.take()로 읽는다. */
export async function lobbyRig(t, { now = T0 } = {}) {
	installResponse();
	t.mock.timers.enable({ apis: ['Date'], now });
	const { Lobby } = await import('../src/lib/server/mp/lobby.ts');
	const ctx = new FakeCtx();
	const r = { Lobby, ctx };
	r.revive = async () => {
		r.lobby = new Lobby(ctx, {});
		await Promise.all(ctx.blocked);
		return r.lobby;
	};
	await r.revive();

	r.advance = (ms) => t.mock.timers.tick(ms);
	r.at = (ms) => t.mock.timers.setTime(ms);
	r.stored = () => ctx.storage.data.get('rooms');
	r.alarmAt = () => ctx.storage.alarm;
	r.subscribe = async () => {
		const res = await r.lobby.fetch(WS_REQUEST());
		assert.equal(res.status, 101);
		return ctx.sockets.at(-1);
	};
	r.drop = async (ws, code = 1001) => {
		ws.readyState = CLOSED;
		await r.lobby.webSocketClose(ws, code);
		ctx.release(ws);
	};
	r.fireAlarm = async () => {
		const at = ctx.storage.alarm;
		assert.notEqual(at, null, '걸린 알람이 없다');
		if (at > Date.now()) t.mock.timers.setTime(at);
		ctx.storage.alarm = null;
		await r.lobby.alarm();
		return at;
	};
	return r;
}

/** 공개 방 목록 항목. updatedAt은 Lobby가 덮어쓴다. */
export const summary = (code, over = {}) => ({ code, host: '방장이름', kind: 'comp', game: 'single', players: 2, max: 5, inProgress: false, length: 6, tries: 6, hard: false, timer: false, updatedAt: 0, ...over });
