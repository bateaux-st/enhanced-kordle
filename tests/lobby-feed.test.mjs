import assert from 'node:assert/strict';
import test from 'node:test';
import { installBrowser } from './fake-browser.mjs';
import { watchLobby } from '../src/lib/mp/lobby-feed.ts';
import { HEARTBEAT_MS, LOBBY_FALLBACK_POLL_MS } from '../src/lib/mp/rules.ts';

const DEAD_MS = HEARTBEAT_MS * 3;
const RETRY_MIN_MS = 3_000;

function setup(t) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 });
	const env = installBrowser(t);
	const rooms = [];
	const fallback = { count: 0 };
	const stop = watchLobby({ onRooms: (r) => rooms.push(r), onFallback: () => fallback.count++ });
	env.cleanup(stop);
	return { ...env, rooms, fallback, stop, tick: (ms) => t.mock.timers.tick(ms) };
}

test('연결: 주소는 ws-lobby이고 https면 wss', (t) => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 });
	const env = installBrowser(t, { href: 'https://kordle.example/' });
	env.cleanup(watchLobby({ onRooms() {}, onFallback() {} }));
	assert.equal(env.last().url, 'wss://kordle.example/ws-lobby');
});

test('pong이 DEAD_MS를 넘게 없으면 반쯤 끊긴 소켓으로 보고 닫은 뒤 폴링과 재연결로 넘어간다', (t) => {
	const s = setup(t);
	const sock = s.last();
	sock.open();
	s.tick(DEAD_MS);
	assert.equal(sock.readyState, 1, '경계(정확히 DEAD_MS)는 아직 산 것');
	assert.equal(sock.sent.filter((m) => m === 'ping').length, 3);
	s.tick(HEARTBEAT_MS);
	assert.equal(sock.readyState, 3);
	assert.equal(s.sockets.length, 1);
	s.tick(RETRY_MIN_MS);
	assert.equal(s.sockets.length, 2);
	s.tick(LOBBY_FALLBACK_POLL_MS - RETRY_MIN_MS);
	assert.equal(s.fallback.count, 1);
});

test('pong을 받을 때마다 죽은 것으로 보는 기준이 새로 시작한다', (t) => {
	const s = setup(t);
	const sock = s.last();
	sock.open();
	s.tick(HEARTBEAT_MS * 2);
	sock.message('pong');
	s.tick(HEARTBEAT_MS * 3);
	assert.equal(sock.readyState, 1);
	assert.equal(s.sockets.length, 1);
});

test('숨은 탭은 소켓이 끊겨도 폴링과 재시도를 쉬고, 보이면 한 번 조회하고 다시 붙는다', (t) => {
	const s = setup(t);
	s.last().open();
	s.setVisibility('hidden');
	s.last().drop();
	s.tick(60_000 * 3);
	assert.equal(s.fallback.count, 0);
	assert.equal(s.sockets.length, 1);
	s.setVisibility('visible');
	assert.equal(s.fallback.count, 1);
	assert.equal(s.sockets.length, 2);
});

test('탭이 보일 때 소켓이 살아 있고 최근에 응답이 있었으면 아무것도 하지 않는다', (t) => {
	const s = setup(t);
	s.last().open();
	s.tick(HEARTBEAT_MS);
	s.setVisibility('hidden');
	s.setVisibility('visible');
	assert.equal(s.fallback.count, 0);
	assert.equal(s.sockets.length, 1);
	assert.equal(s.last().readyState, 1);
});

test('절전에서 깨어난 탭은 하트비트를 기다리지 않고 죽은 소켓을 버려 바로 다시 붙는다', (t) => {
	const s = setup(t);
	const sock = s.last();
	sock.open();
	// 타이머는 돌리지 않고 시계만 넘겨 close 없이 잠든 기기를 흉내 낸다.
	t.mock.timers.setTime(DEAD_MS + 1);
	s.setVisibility('visible');
	assert.equal(sock.readyState, 3);
	assert.equal(s.fallback.count, 1);
	assert.equal(s.sockets.length, 2);
});

test('배열이 아닌 메시지와 깨진 JSON·바이너리는 버리고 배열만 onRooms로 보낸다', (t) => {
	const s = setup(t);
	const sock = s.last();
	sock.open();
	for (const bad of ['{}', 'pong', 'not json', '"x"', new ArrayBuffer(1)]) sock.message(bad);
	assert.equal(s.rooms.length, 0);
	sock.message('[]');
	assert.deepEqual(s.rooms, [[]]);
});

test('WebSocket을 만들 수 없는 망에서는 폴링하고 재시도 간격이 3초에서 60초까지 두 배로 는다', (t) => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 });
	const env = installBrowser(t);
	env.throwOnConstruct = true;
	let fallbacks = 0;
	env.cleanup(watchLobby({ onRooms() {}, onFallback: () => fallbacks++ }));
	assert.equal(env.attempts, 1);
	const gaps = [3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000];
	gaps.forEach((gap, i) => {
		t.mock.timers.tick(gap - 1);
		assert.equal(env.attempts, i + 1, `${gap}ms 직전`);
		t.mock.timers.tick(1);
		assert.equal(env.attempts, i + 2, `${gap}ms 뒤`);
	});
	assert.ok(fallbacks > 0);
});

// mock.timers가 갈아 끼운 setInterval/clearInterval을 감싸 살아 있는 주기 타이머를 센다. 반환 함수로 반드시 원복한다.
function trackIntervals() {
	const live = new Set();
	const { setInterval: set, clearInterval: clear } = globalThis;
	globalThis.setInterval = (...args) => { const id = set(...args); live.add(id); return id; };
	globalThis.clearInterval = (id) => { live.delete(id); clear(id); };
	return { live, restore: () => Object.assign(globalThis, { setInterval: set, clearInterval: clear }) };
}

test('정리 함수: 소켓을 1000으로 닫고 리스너와 하트비트를 거둔다', (t) => {
	const s = setup(t);
	const timers = trackIntervals();
	try {
		const sock = s.last();
		sock.open();
		assert.equal(s.listeners.size, 1);
		assert.equal(timers.live.size, 1);
		s.stop();
		assert.equal(sock.closeCode, 1000);
		assert.equal(s.listeners.size, 0);
		assert.equal(timers.live.size, 0);
		s.tick(DEAD_MS * 5);
		s.setVisibility('visible');
		assert.equal(s.fallback.count, 0);
		assert.equal(s.sockets.length, 1);
	} finally {
		timers.restore();
	}
});

test('정리 함수: 끊긴 동안 불러도 폴링과 재연결 타이머를 거둔다', (t) => {
	const s = setup(t);
	const timers = trackIntervals();
	try {
		s.last().open();
		s.last().drop();
		assert.equal(timers.live.size, 1, '끊기면 폴링이 시작된다');
		s.stop();
		assert.equal(timers.live.size, 0);
		s.tick(LOBBY_FALLBACK_POLL_MS * 8);
		assert.equal(s.fallback.count, 0);
		assert.equal(s.sockets.length, 1);
	} finally {
		timers.restore();
	}
});
