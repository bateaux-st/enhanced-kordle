import assert from 'node:assert/strict';
import test from 'node:test';
import { NAMES, ofType, rig, T0 } from './do-runtime.mjs';
import { stageAnswer } from './mp-helpers.mjs';

const BANANA = { word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' };
const POOL = { '3:6': [BANANA] };
const GRAY = 'ㅋㅋㅋㅋㅋㅋ';
const UNAVAILABLE = '서버에 연결할 수 없습니다';

/** t=3 풀: n마다 단어 두 개. 정답이 어느 idx인지는 조회 인자로 확인한다. */
const poolFor = (lengths) => Object.fromEntries(lengths.map((n) => [`3:${n}`, [stageAnswer(n), { ...stageAnswer(n), word: `다른${n}` }]]));

const errors = (ws) => ofType(ws.take(), 'error');

test('단판 시작: pool_meta 한 행과 pool 한 행만 읽어 정답을 정한다(t=3)', async (t) => {
	const r = await rig(t, { pool: { '3:6': [BANANA, { word: '나바나', jamo: 'ㄴㅏㅂㅏㄴㅏ' }, { word: '다바나', jamo: 'ㄷㅏㅂㅏㄴㅏ' }] } });
	const [host] = await r.players();
	await r.send(host.ws, { type: 'start' });

	assert.equal(r.db.queries.length, 2);
	const [count, at] = r.db.queries;
	assert.deepEqual(count.args, [3, 6]);
	assert.match(count.sql, /pool_meta WHERE t = \? AND n = \?$/);
	assert.deepEqual(at.args.slice(0, 2), [3, 6]);
	assert.ok(Number.isInteger(at.args[2]) && at.args[2] >= 0 && at.args[2] < 3);
	assert.deepEqual(r.state().game.answers[6], r.db.pool['3:6'][at.args[2]]);
	assert.equal(r.state().phase, 'playing');
	assert.equal(r.state().game.startN, 6);
});

test('등반 시작: 시작 길이부터 12자까지 모든 스테이지를 시작 때 읽는다', async (t) => {
	const r = await rig(t, { pool: poolFor([10, 11, 12]) });
	const [host] = await r.players([NAMES[1]], { game: 'climb', length: 10 });
	await r.send(host.ws, { type: 'start' });

	assert.equal(r.db.count('count'), 3);
	assert.equal(r.db.count('at'), 3);
	assert.deepEqual(r.db.queries.filter((q) => q.args.length === 2).map((q) => q.args[1]).sort(), [10, 11, 12]);
	assert.ok(r.db.queries.every((q) => q.args[0] === 3));
	assert.deepEqual(Object.keys(r.state().game.answers).map(Number).sort(), [10, 11, 12]);
	for (const n of [10, 11, 12]) {
		const idx = r.db.queries.find((q) => q.args.length === 3 && q.args[1] === n).args[2];
		assert.deepEqual(r.state().game.answers[n], r.db.pool[`3:${n}`][idx]);
	}
});

test('5자에서 시작하는 등반은 16행(스테이지 8개 x 2)을 읽는다', async (t) => {
	const r = await rig(t, { pool: poolFor([5, 6, 7, 8, 9, 10, 11, 12]) });
	const [host] = await r.players([NAMES[1]], { game: 'climb', length: 5 });
	await r.send(host.ws, { type: 'start' });
	assert.equal(r.db.queries.length, 16);
	assert.equal(Object.keys(r.state().game.answers).length, 8);
});

test('길이가 random이면 시작 때 정한 길이부터 12자까지 읽고 설정은 random으로 남는다', async (t) => {
	const r = await rig(t, { pool: poolFor([5, 6, 7, 8, 9, 10, 11, 12]) });
	const [host] = await r.players([NAMES[1]], { game: 'climb', length: 'random' });
	await r.send(host.ws, { type: 'start' });
	const startN = r.state().game.startN;
	assert.ok(startN >= 5 && startN <= 12);
	assert.equal(r.db.queries.length, (12 - startN + 1) * 2);
	assert.deepEqual(r.db.queries.filter((q) => q.args.length === 2).map((q) => q.args[1]).sort((a, b) => a - b), Array.from({ length: 13 - startN }, (_, i) => startN + i));
	assert.equal(r.state().settings.length, 'random');
});

test('조회가 실패하면(풀 비어 있음·행 없음·D1 오류) 방장에게만 unavailable을 보내고 방은 대기실 그대로다', async (t) => {
	for (const [label, setup] of [
		['pool_meta 행 없음', (r) => delete r.db.pool['3:6']],
		['pool_meta 0행', (r) => (r.db.pool['3:6'] = [])],
		['pool 행 없음', (r) => (r.db.pool['3:6'] = [undefined])],
		['D1 오류', (r) => (r.db.failWith = new Error('d1 down'))]
	]) {
		await t.test(label, async (st) => {
			const r = await rig(st, { pool: structuredClone(POOL) });
			const [host, guest] = await r.players();
			setup(r);
			const puts = r.ctx.storage.puts('state');
			await r.send(host.ws, { type: 'start' });
			assert.deepEqual(errors(host.ws).map((e) => [e.code, e.msg]), [['unavailable', UNAVAILABLE]]);
			assert.deepEqual(guest.ws.sent, []);
			assert.equal(r.state().phase, 'lobby');
			assert.equal(r.ctx.storage.puts('state'), puts);
		});
	}
});

test('등반은 스테이지 하나라도 읽지 못하면 시작하지 않는다', async (t) => {
	const pool = poolFor([10, 11, 12]);
	delete pool['3:12'];
	const r = await rig(t, { pool });
	const [host] = await r.players([NAMES[1]], { game: 'climb', length: 10 });
	await r.send(host.ws, { type: 'start' });
	assert.equal(errors(host.ws)[0].code, 'unavailable');
	assert.equal(r.state().phase, 'lobby');
	assert.equal(r.state().game, null);
});

test('시작이 거절될 요청은 D1을 읽지 않는다(방장이 아님, 준비 안 함, 혼자, 이미 진행 중)', async (t) => {
	const r = await rig(t, { pool: POOL });
	const host = await r.open();
	await r.send(host.ws, { type: 'start' });
	assert.equal(errors(host.ws)[0].msg, '두 명 이상 모여야 시작할 수 있습니다');

	const guest = await r.hello(NAMES[1]);
	guest.ws.take();
	await r.send(guest.ws, { type: 'start' });
	assert.equal(errors(guest.ws)[0].msg, '방장만 시작할 수 있습니다');
	await r.send(host.ws, { type: 'start' });
	assert.equal(errors(host.ws)[0].msg, '1명이 아직 준비하지 않았습니다');
	assert.equal(r.db.queries.length, 0);

	await r.send(guest.ws, { type: 'ready', on: true });
	await r.send(host.ws, { type: 'start' });
	assert.equal(r.db.queries.length, 2);
	r.db.queries.length = 0;
	await r.send(host.ws, { type: 'start' });
	assert.equal(errors(host.ws).at(-1).msg, '이미 시작했습니다');
	assert.equal(r.db.queries.length, 0);
});

test('대기실 시작은 인원을 세기 전에 응답 없는 소켓을 정리하고, 요청을 보낸 방장 소켓은 정리하지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL });
	const [host, guest] = await r.players();
	r.at(T0 + 100_000);
	await r.send(host.ws, { type: 'start' });

	assert.deepEqual(guest.ws.closed, { code: 1001, reason: 'stale' });
	assert.equal(host.ws.closed, null);
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).connected, false);
	assert.equal(errors(host.ws).at(-1).msg, '두 명 이상 모여야 시작할 수 있습니다');
	assert.equal(r.db.queries.length, 0);
});

test('guess: 길이가 맞고 진행 중일 때만 valid를 한 번 읽는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [GRAY] });
	const [host, guest] = await r.players();
	await r.send(guest.ws, { type: 'guess', jamo: GRAY });
	assert.equal(r.db.count('valid'), 0, '대기실에서는 읽지 않는다');
	await r.send(host.ws, { type: 'start' });
	guest.ws.take();
	r.db.queries.length = 0;

	await r.send(guest.ws, { type: 'guess', jamo: 'ㅋㅋㅋ' });
	assert.equal(r.db.queries.length, 0, '길이가 다르면 읽지 않는다');
	assert.equal(errors(guest.ws).length, 1);

	await r.send(guest.ws, { type: 'guess', jamo: GRAY });
	assert.deepEqual(r.db.queries, [{ sql: 'SELECT 1 FROM valid WHERE jamo = ?', args: [GRAY] }]);
	assert.equal(r.state().game.players[guest.pid].board.rows.length, 1);
	assert.equal(ofType(host.ws.take(), 'snap').length >= 1, true);
});

test('guess: 사전에 없는 말은 invalid로 거절하고 저장·방송하지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [] });
	const [host, guest] = await r.players();
	await r.send(host.ws, { type: 'start' });
	host.ws.take();
	guest.ws.take();
	const puts = r.ctx.storage.puts('state');

	await r.send(guest.ws, { type: 'guess', jamo: 'ㅂㅏㄴㅏㄴㅂ' });
	assert.equal(r.db.count('valid'), 1);
	assert.equal(errors(guest.ws)[0].code, 'invalid');
	assert.equal(r.state().game.players[guest.pid].board.rows.length, 0);
	assert.equal(r.ctx.storage.puts('state'), puts);
	assert.deepEqual(host.ws.sent, []);
});

test('guess: D1가 실패하면 사전 판정 없이 거절하고 상태를 바꾸지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [GRAY] });
	const [host, guest] = await r.players();
	await r.send(host.ws, { type: 'start' });
	guest.ws.take();
	r.db.failWith = new Error('d1 down');

	await r.send(guest.ws, { type: 'guess', jamo: GRAY });
	assert.equal(r.db.count('valid'), 1);
	assert.equal(errors(guest.ws)[0].code, 'unavailable');
	assert.equal(r.state().game.players[guest.pid].board.rows.length, 0);

	r.db.failWith = null;
	await r.send(guest.ws, { type: 'guess', jamo: GRAY });
	assert.equal(r.state().game.players[guest.pid].board.rows.length, 1, '복구되면 같은 요청이 통한다');
});

test('포기해 끝난 사람의 guess는 D1을 읽지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [GRAY] });
	const [host, guest] = await r.players([NAMES[1], NAMES[2]]);
	await r.send(host.ws, { type: 'start' });
	await r.send(guest.ws, { type: 'giveup' });
	r.db.queries.length = 0;
	await r.send(guest.ws, { type: 'guess', jamo: GRAY });
	assert.equal(r.db.queries.length, 0);
});

test('협동 방의 guess는 D1을 읽지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [GRAY] });
	const [host] = await r.players([NAMES[1]], { kind: 'coop' });
	await r.send(host.ws, { type: 'start' });
	r.db.queries.length = 0;
	await r.send(host.ws, { type: 'guess', jamo: GRAY });
	assert.equal(r.db.queries.length, 0);
});

test('협동 propose: 제안 단계에서 자리가 있는 사람만 valid를 읽고, 투표 단계에서는 읽지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [BANANA.jamo, GRAY] });
	const [host, guest] = await r.players([NAMES[1]], { kind: 'coop' });
	await r.send(host.ws, { type: 'propose', jamo: GRAY });
	assert.equal(r.db.queries.length, 0, '대기실에서는 읽지 않는다');
	await r.send(host.ws, { type: 'start' });
	r.db.queries.length = 0;

	await r.send(host.ws, { type: 'propose', jamo: GRAY });
	assert.deepEqual(r.db.queries, [{ sql: 'SELECT 1 FROM valid WHERE jamo = ?', args: [GRAY] }]);
	await r.send(guest.ws, { type: 'propose', jamo: BANANA.jamo });
	assert.equal(r.db.queries.length, 2);
	assert.equal(r.state().game.step.kind, 'vote');

	await r.send(host.ws, { type: 'propose', jamo: GRAY });
	assert.equal(r.db.queries.length, 2, '투표 단계의 제안은 D1 없이 거절한다');
	assert.equal(errors(host.ws).at(-1).code !== undefined, true);
});

test('경쟁 방의 propose, 초안·준비 같은 메시지는 D1을 읽지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [GRAY] });
	const [host, guest] = await r.players();
	await r.send(host.ws, { type: 'start' });
	r.db.queries.length = 0;
	for (const msg of [{ type: 'propose', jamo: GRAY }, { type: 'draft', jamo: 'ㅂ' }, { type: 'hint' }, { type: 'nudge' }]) await r.send(guest.ws, msg);
	assert.equal(r.db.queries.length, 0);
});

test('D1 조회 사이에 상태가 바뀌면 적용 시점에 다시 검증한다(기다리는 동안 포기한 사람의 guess는 거절)', async (t) => {
	const r = await rig(t, { pool: POOL, valid: [GRAY] });
	const [host, guest] = await r.players();
	await r.send(host.ws, { type: 'start' });
	guest.ws.take();
	let release;
	r.db.gate = new Promise((resolve) => (release = resolve));

	const pending = r.send(guest.ws, { type: 'guess', jamo: GRAY });
	await r.settle();
	r.db.gate = null;
	await r.send(guest.ws, { type: 'giveup' });
	assert.equal(r.state().game.players[guest.pid].status, 'gaveup');
	release();
	await pending;

	assert.equal(r.state().game.players[guest.pid].board.rows.length, 0);
	assert.equal(errors(guest.ws).length, 1);
});
