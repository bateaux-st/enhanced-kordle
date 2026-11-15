import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { compileModule } from 'svelte/compiler';
import { installBrowser } from './fake-browser.mjs';
import { installLocalStorage } from './fake-local-storage.mjs';

// daily.test.mjs와 같은 방식으로 실제 MpClient의 runes를 컴파일한다. 이 파일은 상대 import에 이미 .ts가 붙어 있고,
// import.meta.env는 vite가 채우는 값이라 노드에는 없으므로 DEV를 끈 코드로 바꿔 컴파일한다.
const file = new URL('../src/lib/mp/client.svelte.ts', import.meta.url);
const source = stripTypeScriptTypes(readFileSync(file, 'utf8')).replaceAll('import.meta.env.DEV', 'false');
const { js } = compileModule(source, { filename: file.pathname, generate: 'client' });
const code = js.code.replace(/from '([^']+)'/g, (_, id) =>
	`from '${id.startsWith('.') ? new URL(id, file).href : import.meta.resolve(id)}'`);
const { MpClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const ROOM = 'ABC234';
const NAME = '철수철수철';
const NOW = 1_000_000;
const snap = (seq, now = NOW) => ({ type: 'snap', snap: { seq, now } });

function setup(t) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
	const values = installLocalStorage(t);
	const env = installBrowser(t, { href: 'http://x/' });
	const client = new MpClient();
	env.cleanup(() => client.dispose());
	client.connect(ROOM, NAME);
	return { ...env, client, values, tick: (ms) => t.mock.timers.tick(ms) };
}

const roomParam = (env) => new URL(env.location.href).searchParams.get('room');

test('connect: 방 주소를 URL에 싣고 소켓을 열어 hello를 보낸다', (t) => {
	const s = setup(t);
	assert.equal(s.client.status, 'connecting');
	assert.equal(s.last().url, `ws://x/ws/${ROOM}`);
	assert.equal(roomParam(s), ROOM);
	s.last().open();
	assert.deepEqual(JSON.parse(s.last().sent[0]), { type: 'hello', name: NAME });
});

test('스냅샷: seq가 더 낮은 낡은 스냅샷은 무시하고 같은 seq는 덮어쓴다', (t) => {
	const s = setup(t);
	s.last().open();
	s.last().message(snap(5));
	const fresh = s.client.snap;
	assert.equal(s.client.status, 'open');
	s.last().message(snap(3));
	assert.equal(s.client.snap, fresh);
	s.last().message(snap(5));
	assert.notEqual(s.client.snap, fresh);
	assert.equal(s.client.snap.seq, 5);
});

test('서버 시계 보정: 낡은 스냅샷은 보정값도 바꾸지 않고 시간이 가도 보정이 유지된다', (t) => {
	const s = setup(t);
	s.last().open();
	s.last().message(snap(2, NOW + 30_000));
	assert.equal(s.client.serverNow(), Date.now() + 30_000);
	s.last().message(snap(1, NOW - 90_000));
	assert.equal(s.client.serverNow(), Date.now() + 30_000);
	s.tick(5_000);
	assert.equal(s.client.serverNow(), NOW + 5_000 + 30_000);
	s.last().message(snap(3, NOW + 5_000 - 7_000));
	assert.equal(s.client.serverNow(), Date.now() - 7_000);
});

test('끊김: 즉시 한 번, 2초 뒤 한 번 다시 붙고 그래도 안 되면 lost로 멈추되 방 주소는 남긴다', (t) => {
	const s = setup(t);
	s.last().open();
	s.last().drop(1006);
	assert.equal(s.sockets.length, 2);
	assert.equal(s.client.status, 'reconnecting');
	s.last().drop(1006);
	assert.equal(s.sockets.length, 2);
	s.tick(1_999);
	assert.equal(s.sockets.length, 2);
	s.tick(1);
	assert.equal(s.sockets.length, 3);
	s.last().drop(1006);
	assert.equal(s.client.status, 'closed');
	assert.equal(s.client.closeReason, 'lost');
	assert.equal(roomParam(s), ROOM);
});

test('탭 복귀: lost로 멈춘 탭이 보이면 다시 붙고 시도 횟수를 처음부터 센다', (t) => {
	const s = setup(t);
	s.last().drop(1006);
	s.last().drop(1006);
	s.tick(2_000);
	s.last().drop(1006);
	assert.equal(s.client.closeReason, 'lost');
	const before = s.sockets.length;
	s.setVisibility('hidden');
	assert.equal(s.sockets.length, before, '숨는 것만으로는 붙지 않는다');
	s.setVisibility('visible');
	assert.equal(s.sockets.length, before + 1);
	assert.equal(s.client.status, 'reconnecting');
	assert.equal(s.client.closeReason, null);
	s.last().drop(1006);
	assert.equal(s.sockets.length, before + 2, '횟수가 0부터라 바로 한 번 더 붙는다');
});

test('탭 복귀: 연결 중이거나 열려 있으면 아무것도 하지 않는다', (t) => {
	const s = setup(t);
	s.setVisibility('visible');
	assert.equal(s.sockets.length, 1);
	s.last().open();
	s.last().message(snap(1));
	s.setVisibility('visible');
	assert.equal(s.sockets.length, 1);
	assert.equal(s.client.status, 'open');
});

test('다시 연결하지 않는 종료 코드는 이유를 매기고 방 주소를 지운다', (t) => {
	const cases = { 4000: 'replaced', 4001: 'full', 4002: 'in_progress', 4004: 'no_room', 4005: 'destroyed', 1008: 'bad_name' };
	const s = setup(t);
	for (const [code, reason] of Object.entries(cases)) {
		s.client.connect(ROOM, NAME);
		const count = s.sockets.length;
		s.last().open();
		s.last().drop(Number(code));
		assert.equal(s.client.status, 'closed', code);
		assert.equal(s.client.closeReason, reason, code);
		assert.equal(s.sockets.length, count, `${code}는 재시도하지 않는다`);
		assert.equal(roomParam(s), null, code);
	}
});

test('leave: 소켓을 1000으로 닫고 left로 멈춘다', (t) => {
	const s = setup(t);
	const sock = s.last();
	sock.open();
	sock.message(snap(1));
	s.client.leave();
	assert.equal(sock.closeCode, 1000);
	assert.deepEqual(JSON.parse(sock.sent.at(-1)), { type: 'leave' });
	assert.equal(s.client.status, 'closed');
	assert.equal(s.client.closeReason, 'left');
	assert.equal(s.client.snap, null);
	assert.equal(roomParam(s), null);
});

test('다시 connect한 뒤 이전 소켓의 늦은 close는 재접속을 일으키지 않는다', (t) => {
	const s = setup(t);
	const old = s.last();
	old.open();
	const staleClose = old.onclose;
	s.client.connect(ROOM, NAME);
	assert.equal(s.sockets.length, 2);
	assert.equal(s.client.status, 'connecting');
	staleClose({ code: 1006 });
	assert.equal(s.sockets.length, 2);
	assert.equal(s.client.status, 'connecting');
});

test('dispose: 탭 복귀 리스너를 거둬 lost 이후에도 다시 붙지 않는다', (t) => {
	const s = setup(t);
	s.last().drop(1006);
	s.last().drop(1006);
	s.tick(2_000);
	s.last().drop(1006);
	const before = s.sockets.length;
	s.client.dispose();
	assert.equal(s.listeners.size, 0);
	assert.equal(s.client.status, 'idle');
	s.setVisibility('visible');
	assert.equal(s.sockets.length, before);
});
