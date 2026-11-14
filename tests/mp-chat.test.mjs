import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatFeed } from '../src/lib/mp/chat-feed.ts';
import { CHAT_BURST, CHAT_HISTORY, CHAT_KEEP, CHAT_MAX, CHAT_WINDOW_MS, normalizeChat } from '../src/lib/mp/rules.ts';
import { ChatLog, historyMsg, planChat } from '../src/lib/server/mp/chat.ts';
import { parseClientMsg } from '../src/lib/server/mp/parse.ts';
import { joinAll, lobby, started, T0 } from './mp-helpers.mjs';

const p = (v) => parseClientMsg(JSON.stringify(v));
const chat = (text) => p({ type: 'chat', text });

test('parse: 1~100자만 받는다(코드포인트 기준)', () => {
	assert.deepEqual(chat('안녕'), { type: 'chat', text: '안녕' });
	assert.equal(chat(''), null);
	assert.equal(chat('a'.repeat(CHAT_MAX))?.text.length, CHAT_MAX);
	assert.equal(chat('a'.repeat(CHAT_MAX + 1)), null);
	for (const bad of [{ type: 'chat' }, { type: 'chat', text: 5 }, { type: 'chat', text: ['a'] }, { type: 'chat', text: null }]) assert.equal(p(bad), null, JSON.stringify(bad));
});

test('parse: 앞뒤 공백을 지우고 공백만이면 거절한다', () => {
	assert.equal(chat('  안녕  ').text, '안녕');
	assert.equal(chat('   '), null);
	assert.equal(chat('\n\t \r\n'), null);
	assert.equal(chat('a'.repeat(CHAT_MAX) + '   ').text.length, CHAT_MAX);
});

test('parse: 줄바꿈·탭은 공백이 되고 나머지 제어문자는 지운다', () => {
	assert.equal(chat('가\n나').text, '가 나');
	assert.equal(chat('가\r\n나').text, '가  나');
	assert.equal(chat('가\t나').text, '가 나');
	assert.equal(chat('가 나').text, '가 나');
	assert.equal(chat('가\u0000나\u0007다\u001b\u007f\u0085').text, '가나다');
	assert.equal(chat('\u0000\u0001\u0002'), null, '제어문자만이면 빈 본문');
});

test('parse: 제어문자로 길이를 늘려도 지운 뒤 길이로 잰다', () => {
	assert.equal(chat('a'.repeat(CHAT_MAX) + '\u0000'.repeat(50))?.text.length, CHAT_MAX);
	assert.equal(chat('a'.repeat(CHAT_MAX + 1) + '\u0000'), null);
});

test('parse: 이모지는 코드포인트 한 자로 센다', () => {
	assert.equal(chat('😀'.repeat(CHAT_MAX))?.text, '😀'.repeat(CHAT_MAX));
	assert.equal(chat('😀'.repeat(CHAT_MAX + 1)), null);
	// 결합 문자열은 NFC로 합친 뒤 센다: 한글 자모 3개 -> 완성형 1자
	assert.equal(chat('한').text, '한');
	// ZWJ(Cf)는 제어문자가 아니므로 이모지 시퀀스가 깨지지 않는다
	assert.equal(chat('👨‍👩‍👧').text, '👨‍👩‍👧');
});

test('parse: HTML처럼 보이는 본문도 문자 그대로 둔다(렌더 쪽이 텍스트로 그린다)', () => {
	assert.equal(chat('<b>x</b>').text, '<b>x</b>');
});

test('normalizeChat는 문자열이 아니면 null', () => {
	for (const v of [undefined, null, 1, {}, []]) assert.equal(normalizeChat(v), null);
});

const room = () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가나다라마', '바사아자차']);
	return { s, host, a, b };
};

test('권한: 자리 있는 참가자는 모든 단계에서 보낸다', () => {
	const log = new ChatLog();
	const { s, a } = room();
	assert.equal(s.phase, 'lobby');
	assert.equal(log.post(s, a, '대기실', T0).ok, true);
	const g = started();
	assert.equal(g.s.phase, 'playing');
	assert.equal(log.post(g.s, g.pids[1], '게임 중', T0).ok, true);
	g.s.phase = 'result';
	assert.equal(log.post(g.s, g.pids[1], '결과', T0).ok, true);
	assert.deepEqual(
		log.recent().map((m) => m.text),
		['대기실', '게임 중', '결과']
	);
});

test('권한: 자리가 없는 사람과 나간 사람은 거절하고 기록하지 않는다', () => {
	const log = new ChatLog();
	const { s, a } = room();
	const r = log.post(s, 'pnobody0', '외부인', T0);
	assert.deepEqual([r.ok, r.code], [false, 'forbidden']);
	s.players.find((q) => q.pid === a).left = true;
	const r2 = log.post(s, a, '나간 사람', T0);
	assert.deepEqual([r2.ok, r2.code], [false, 'forbidden']);
	assert.deepEqual(log.recent(), []);
});

test('메시지: id는 하나씩 늘고 이름은 방의 현재 이름, at은 받은 시각', () => {
	const log = new ChatLog();
	const { s, host, a } = room();
	const m1 = log.post(s, host, '하나', T0).msg;
	const m2 = log.post(s, a, '둘', T0 + 10).msg;
	assert.deepEqual(m1, { id: 1, pid: host, name: '방장', text: '하나', at: T0 });
	assert.deepEqual([m2.id, m2.name, m2.at], [2, '가나다라마', T0 + 10]);
});

test('속도 제한: 5초 안에 5개까지, 6번째는 cooldown', () => {
	const log = new ChatLog();
	const { s, host } = room();
	for (let i = 0; i < CHAT_BURST; i++) assert.equal(log.post(s, host, `m${i}`, T0 + i * 100).ok, true, `m${i}`);
	const r = log.post(s, host, '여섯째', T0 + 500);
	assert.deepEqual([r.ok, r.code], [false, 'cooldown']);
	assert.equal(log.recent().length, CHAT_BURST, '거절된 메시지는 기록되지 않는다');
});

test('속도 제한: 사람마다 따로 센다', () => {
	const log = new ChatLog();
	const { s, host, a } = room();
	for (let i = 0; i < CHAT_BURST; i++) log.post(s, host, `m${i}`, T0);
	assert.equal(log.post(s, host, 'x', T0).ok, false);
	assert.equal(log.post(s, a, 'y', T0).ok, true);
});

test('속도 제한: 가장 오래된 메시지가 창을 벗어나면 다시 보낼 수 있다', () => {
	const log = new ChatLog();
	const { s, host } = room();
	for (let i = 0; i < CHAT_BURST; i++) log.post(s, host, `m${i}`, T0 + i * 1000);
	assert.equal(log.post(s, host, 'x', T0 + CHAT_WINDOW_MS - 1).ok, false, '첫 메시지가 아직 창 안');
	assert.equal(log.post(s, host, 'y', T0 + CHAT_WINDOW_MS).ok, true, '첫 메시지가 정확히 5초 지남');
	assert.equal(log.post(s, host, 'z', T0 + CHAT_WINDOW_MS + 1).ok, false, '두 번째 메시지까지 창에 5개');
});

test('속도 제한: 거절된 시도는 창을 밀지 않는다', () => {
	const log = new ChatLog();
	const { s, host } = room();
	for (let i = 0; i < CHAT_BURST; i++) log.post(s, host, `m${i}`, T0);
	for (let t = 1; t < CHAT_WINDOW_MS; t += 500) assert.equal(log.post(s, host, 'spam', T0 + t).ok, false);
	assert.equal(log.post(s, host, '풀림', T0 + CHAT_WINDOW_MS).ok, true);
});

test('링버퍼: 최근 30개만 남고 오래된 것부터 빠진다', () => {
	const log = new ChatLog();
	const { s, host, a } = room();
	for (let i = 1; i <= CHAT_HISTORY + 5; i++) log.post(s, i % 2 ? host : a, `m${i}`, T0 + i * CHAT_WINDOW_MS);
	const r = log.recent();
	assert.equal(r.length, CHAT_HISTORY);
	assert.equal(r[0].text, 'm6');
	assert.equal(r.at(-1).text, `m${CHAT_HISTORY + 5}`);
	assert.deepEqual(
		r.map((m) => m.id),
		Array.from({ length: CHAT_HISTORY }, (_, i) => i + 6),
		'id는 버려진 것까지 이어서 센다'
	);
});

test('recent는 복사본이라 호출자가 바꿔도 기록이 변하지 않는다(history 전송 값)', () => {
	const log = new ChatLog();
	const { s, host } = room();
	log.post(s, host, '하나', T0);
	const h = log.recent();
	h.length = 0;
	assert.equal(log.recent().length, 1);
	assert.deepEqual(new ChatLog().recent(), [], '쉬었다 깬 DO는 빈 기록을 보낸다');
});

test('RoomState에 채팅이 섞이지 않는다(저장하지 않는다)', () => {
	const log = new ChatLog();
	const { s, host } = room();
	const before = JSON.stringify(s);
	log.post(s, host, '저장 금지', T0);
	assert.equal(JSON.stringify(s), before);
});

const srv = (id, text, at, pid = 'pa') => ({ id, pid, name: '가나다라마', text, at });

test('ChatFeed: 기록과 방송이 겹쳐도 한 줄', () => {
	const f = new ChatFeed();
	f.message(srv(1, 'a', 100));
	f.history([srv(1, 'a', 100), srv(2, 'b', 200)]);
	f.message(srv(2, 'b', 200));
	assert.deepEqual(
		f.lines.map((l) => l.text),
		['a', 'b']
	);
});

test('ChatFeed: DO 재시작으로 id가 겹쳐도 시각이 다르면 다른 줄', () => {
	const f = new ChatFeed();
	f.message(srv(1, '옛것', 100));
	f.message(srv(1, '새것', 900));
	assert.equal(f.lines.length, 2);
});

test('ChatFeed: 기록은 시각순으로 시스템 줄과 섞인다', () => {
	const f = new ChatFeed();
	f.system('가나다라마님이 들어왔습니다', 150);
	f.history([srv(1, 'a', 100), srv(2, 'b', 200)]);
	assert.deepEqual(
		f.lines.map((l) => [l.system, l.text]),
		[
			[false, 'a'],
			[true, '가나다라마님이 들어왔습니다'],
			[false, 'b']
		]
	);
});

test('ChatFeed: 줄 키는 겹치지 않고, 100줄을 넘으면 오래된 것부터 버린다', () => {
	const f = new ChatFeed();
	for (let i = 0; i < CHAT_KEEP + 7; i++) i % 2 ? f.system(`s${i}`, i) : f.message(srv(i, `m${i}`, i));
	assert.equal(f.lines.length, CHAT_KEEP);
	assert.equal(f.lines[0].text, 's7');
	assert.equal(new Set(f.lines.map((l) => l.key)).size, CHAT_KEEP);
});

test('ChatFeed: 갱신마다 새 배열을 만든다($state.raw 대입용)', () => {
	const f = new ChatFeed();
	const a = f.lines;
	f.message(srv(1, 'a', 1));
	assert.notEqual(f.lines, a);
	const b = f.lines;
	f.history([srv(1, 'a', 1)]);
	assert.equal(f.lines, b, '새 줄이 없으면 그대로');
	f.clear();
	assert.deepEqual(f.lines, []);
});

test('parse: 제로폭 공백만이거나 보이는 글자가 없으면 거절한다', () => {
	for (const bad of ['​', '​​  ⁠', '﻿', '‍', '‌ ‍', 'ㅤ', 'ᅟᅠ', '⠀', '‮', '­']) assert.equal(chat(bad), null, JSON.stringify(bad));
});

test('parse: 양방향 제어·제로폭 문자는 지우고 나머지 글자는 남긴다', () => {
	assert.equal(chat('‮가나').text, '가나');
	assert.equal(chat('가​나‎다⁦라⁩').text, '가나다라');
	assert.equal(chat('a'.repeat(CHAT_MAX) + '​'.repeat(50))?.text.length, CHAT_MAX);
	assert.equal(chat('a'.repeat(CHAT_MAX + 1) + '​'), null);
});

test('planChat: 받아들이면 자리 있는 열린 소켓 전원에게 chat, 그 밖의 소켓에는 보내지 않는다', () => {
	const log = new ChatLog();
	const { s, host, a } = room();
	const peers = [
		{ ws: 'host', pid: host, open: true },
		{ ws: 'a', pid: a, open: true },
		{ ws: 'closing', pid: a, open: false },
		{ ws: 'nohello', pid: null, open: true }
	];
	const out = planChat(log, s, { ws: 'a', pid: a }, '안녕', T0, peers);
	assert.deepEqual(
		out.map((o) => o.to),
		['host', 'a']
	);
	for (const o of out) assert.deepEqual(o.msg, { type: 'chat', msg: log.recent()[0] });
});

test('planChat: 거절이면 보낸 사람에게만 error를 보내고 기록하지 않는다', () => {
	const log = new ChatLog();
	const { s, host, a } = room();
	const peers = [
		{ ws: 'host', pid: host, open: true },
		{ ws: 'a', pid: a, open: true }
	];
	for (let i = 0; i < CHAT_BURST; i++) planChat(log, s, { ws: 'a', pid: a }, `m${i}`, T0, peers);
	const out = planChat(log, s, { ws: 'a', pid: a }, '여섯째', T0, peers);
	assert.equal(out.length, 1);
	assert.equal(out[0].to, 'a');
	assert.equal(out[0].msg.type, 'error');
	assert.equal(out[0].msg.code, 'cooldown');
	assert.equal(log.recent().length, CHAT_BURST);
});

test('historyMsg: 접속 시 보내는 최근 기록, 비어 있으면 빈 목록', () => {
	const log = new ChatLog();
	assert.deepEqual(historyMsg(log), { type: 'chat_history', msgs: [] });
	const { s, host } = room();
	log.post(s, host, '하나', T0);
	assert.deepEqual(historyMsg(log), { type: 'chat_history', msgs: log.recent() });
});
