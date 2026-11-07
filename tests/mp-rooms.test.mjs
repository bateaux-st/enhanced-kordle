import assert from 'node:assert/strict';
import test from 'node:test';
import { LOBBY_LIST_MAX, LOBBY_REFRESH_MS, LOBBY_STALE_MS } from '../src/lib/mp/rules.ts';
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { disconnect, join, leave } from '../src/lib/server/mp/members.ts';
import { isListed, listRooms, nextStaleAt, sameList, sameSummary, summarize } from '../src/lib/server/mp/rooms.ts';
import { initRoom } from '../src/lib/server/mp/state.ts';
import { joinAll, lobby, rng, started, T0 } from './mp-helpers.mjs';

const room = (code, over = {}) => ({ code, host: '방장', kind: 'comp', game: 'single', players: 2, max: 5, inProgress: false, updatedAt: T0, ...over });

test('요약: 방장 이름·종류·게임·인원·진행 중 여부, 정답·uid는 없다', () => {
	const s = lobby();
	joinAll(s, ['가']);
	assert.deepEqual(summarize(s, T0 + 5), { code: 'ABC234', host: '방장', kind: 'comp', game: 'single', players: 2, max: 5, inProgress: false, updatedAt: T0 + 5 });
	assert.equal(summarize(started(['가']).s, T0).inProgress, true);
	s.hostPid = null;
	assert.equal(summarize(s, T0).host, '');
	assert.ok(!JSON.stringify(summarize(started().s, T0)).includes('uid-'));
});

test('sameSummary는 updatedAt을 무시하고 나머지가 하나라도 다르면 다르다', () => {
	assert.ok(sameSummary(room('A'), room('A', { updatedAt: T0 + 999 })));
	for (const over of [{ host: '다른' }, { players: 3 }, { inProgress: true }, { kind: 'coop' }, { game: 'climb' }]) assert.ok(!sameSummary(room('A'), room('A', over)), JSON.stringify(over));
});

test('목록: 입장 가능한 방 먼저, 그 안에서 최신순', () => {
	const rooms = {
		old: room('old', { updatedAt: T0 }),
		fresh: room('fresh', { updatedAt: T0 + 50 }),
		playing: room('playing', { updatedAt: T0 + 100, inProgress: true }),
		full: room('full', { updatedAt: T0 + 90, players: 5 })
	};
	const { list, pruned } = listRooms(rooms, T0 + 200);
	assert.deepEqual(list.map((r) => r.code), ['fresh', 'old', 'playing', 'full']);
	assert.equal(pruned, false);
});

test('150초 넘게 갱신 없는 방은 목록에서 빠지고 저장소에서도 지운다', () => {
	const rooms = { stale: room('stale', { updatedAt: T0 }), live: room('live', { updatedAt: T0 + LOBBY_STALE_MS }) };
	assert.deepEqual(listRooms(rooms, T0 + LOBBY_STALE_MS).list.map((r) => r.code), ['live', 'stale'], '정확히 LOBBY_STALE_MS는 아직 유효');
	const r = listRooms(rooms, T0 + LOBBY_STALE_MS + 1);
	assert.deepEqual([r.list.map((x) => x.code), r.pruned, Object.keys(rooms)], [['live'], true, ['live']]);
});

test('방이 없으면 빈 배열, 최대 50개', () => {
	assert.deepEqual(listRooms({}, T0), { list: [], pruned: false });
	const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`r${i}`, room(`r${i}`, { updatedAt: T0 + i })]));
	const { list } = listRooms(many, T0 + 100);
	assert.equal(list.length, LOBBY_LIST_MAX);
	assert.equal(list[0].code, 'r69');
});

test('목록 인원은 접속자 수: 끊긴 자리는 세지 않는다', () => {
	const s = lobby();
	const [, a] = joinAll(s, ['가', '나']);
	assert.equal(summarize(s, T0).players, 3);
	disconnect(s, a, T0 + 1);
	assert.equal(summarize(s, T0 + 1).players, 2);
	assert.equal(s.players.length, 3);
});

test('접속자가 0명이면 목록에 내지 않고, 한 명이라도 돌아오면 다시 낸다', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	assert.equal(isListed(s), true);
	disconnect(s, a, T0 + 1);
	assert.equal(isListed(s), true, '방장이 접속 중');
	disconnect(s, host, T0 + 2);
	assert.equal(isListed(s), false);
	assert.equal(summarize(s, T0 + 2).players, 0);
	join(s, { uid: 'uid-가', name: '가' }, T0 + 3, rng);
	assert.equal(isListed(s), true);
});

test('방 생성 직후(방장 예약만 있고 아무도 접속 전)는 목록에 나오지 않는다', () => {
	const s = initRoom('ABC234', { uid: 'uid-creator', name: '생성자' }, DEFAULT_SETTINGS, T0, rng);
	assert.equal(isListed(s), false);
	join(s, { uid: 'uid-creator', name: '생성자' }, T0 + 1, rng);
	assert.equal(isListed(s), true);
});

test('모두 나가기로 떠난 방도 목록에 나오지 않는다', () => {
	const s = lobby();
	leave(s, s.hostPid, T0 + 1);
	assert.equal(isListed(s), false);
});

test('심장박동이 끊긴 방(재시작 뒤 소켓 없이 남은 방)은 STALE 직후 목록에서 빠지고 정리된다', () => {
	assert.equal(LOBBY_STALE_MS, 750_000);
	assert.ok(LOBBY_STALE_MS >= 2 * LOBBY_REFRESH_MS, '심장박동 두 번은 놓쳐도 유지');
	const rooms = { ghost: room('ghost', { updatedAt: T0, players: 1 }), beating: room('beating', { updatedAt: T0 + LOBBY_REFRESH_MS * 2, players: 1 }) };
	const r = listRooms(rooms, T0 + LOBBY_STALE_MS + 1);
	assert.deepEqual([r.list.map((x) => x.code), r.pruned, Object.keys(rooms)], [['beating'], true, ['beating']]);
});

test('구독 푸시 판정: updatedAt·순서만 다르면 같은 목록, 항목·길이가 다르면 다른 목록', () => {
	const a = [room('A'), room('B')];
	assert.ok(sameList(a, [room('A', { updatedAt: T0 + 60_000 }), room('B', { updatedAt: T0 + 1 })]), '심장박동은 푸시하지 않는다');
	assert.ok(sameList([], []));
	assert.ok(sameList(a, [room('B'), room('A')]), '심장박동 재정렬은 푸시하지 않는다');
	assert.ok(!sameList(a, [room('A'), room('C')]), '같은 길이라도 방이 바뀌면 보낸다');
	assert.ok(!sameList(a, [room('A')]));
	assert.ok(!sameList(a, [room('A'), room('B', { players: 3 })]));
});

test('만료 알람 시각: 가장 오래된 방의 updatedAt + STALE + 1, 방이 없으면 null, 그 시각에 listRooms가 실제로 뺀다', () => {
	assert.equal(nextStaleAt({}), null);
	const rooms = { a: room('a', { updatedAt: T0 + 10 }), b: room('b', { updatedAt: T0 }) };
	const at = nextStaleAt(rooms);
	assert.equal(at, T0 + LOBBY_STALE_MS + 1);
	assert.equal(listRooms({ ...rooms }, at - 1).list.length, 2);
	assert.deepEqual(listRooms({ ...rooms }, at).list.map((r) => r.code), ['a']);
});
