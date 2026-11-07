import assert from 'node:assert/strict';
import test from 'node:test';
import { hintPos, parseKnown, pickHint } from '../src/lib/hint.ts';
import { judge } from '../src/lib/server/judge.ts';
import { hintFor } from '../src/lib/server/mp/comp.ts';

// 그끄제: ㄱ이 셋(0·2·3번째 칸). 마지막 행은 0번째 ㄱ만 초록, 4번째 ㄱ은 노랑이다.
const GEUKKEUJE = 'ㄱㅡㄱㄱㅡㅈㅓㅣ';
const board = (answer, rows) => ({ rows, marks: rows.map((r) => judge(answer, r)) });

test('그끄제: 키보드는 ㄱ이 초록이어도 보드의 노란 ㄱ을 후보로 삼고 초록 자리를 뺀다', () => {
	const b = board(GEUKKEUJE, ['ㄱㅛㅇㅕㄱㅁㅜㄹ']);
	assert.deepEqual(b.marks[0], ['c', 'a', 'a', 'a', 'p', 'a', 'a', 'a']);
	assert.deepEqual(pickHint(b.rows, b.marks), { jamo: 'ㄱ', known: [0] });
	assert.equal(hintPos(GEUKKEUJE, 'ㄱ', [0]), 2);
	assert.deepEqual(hintFor(b, GEUKKEUJE), { ok: true, pos: 2, jamo: 'ㄱ' });
});

test('초록으로 정답 속 개수를 다 찾은 자모는 후보가 아니고 다음 노랑으로 넘어간다', () => {
	// ㄴ은 처음엔 노랑이지만 둘째 행에서 두 자리 모두 초록이 된다.
	const answer = 'ㅂㅏㄴㅏㄴㅏ';
	const b = board(answer, ['ㄴㅂㅋㅋㅋㅋ', 'ㅋㅋㄴㅋㄴㅋ']);
	assert.deepEqual(pickHint(b.rows, b.marks), { jamo: 'ㅂ', known: [] });
	assert.deepEqual(hintFor(b, answer), { ok: true, pos: 0, jamo: 'ㅂ' });
});

test('노랑이 없거나 노랑이 전부 초록으로 해소됐으면 null', () => {
	assert.equal(pickHint([], []), null);
	const b = board('ㅂㅏㄴㅏㄴㅏ', ['ㅋㅋㅋㅋㅋㅋ', 'ㅋㅋㄴㅋㄴㅋ']);
	assert.equal(pickHint(b.rows, b.marks), null);
	assert.equal(hintFor(b, 'ㅂㅏㄴㅏㄴㅏ').ok, false);
});

test('후보는 행·칸 순으로 처음 나온 노랑이고, 다른 행에서 확인된 초록 자리도 known에 든다', () => {
	const answer = 'ㅂㅏㄴㅏㄴㅏ';
	const b = board(answer, ['ㄴㅏㄴㅂㅏㅇ']); // p c c p p a: ㄴ이 초록(2)과 노랑(0)을 함께 받는다
	assert.deepEqual(pickHint(b.rows, b.marks), { jamo: 'ㄴ', known: [2] });
	assert.equal(hintPos(answer, 'ㄴ', [2]), 4);
});

test('hintPos: known을 뺀 첫 자리, 구버전 요청(known 없음)은 정답의 첫 자리, 다 알면 -1', () => {
	assert.equal(hintPos(GEUKKEUJE, 'ㄱ', []), 0);
	assert.equal(hintPos(GEUKKEUJE, 'ㄱ', parseKnown(undefined)), 0);
	assert.equal(hintPos(GEUKKEUJE, 'ㄱ', [0, 2]), 3);
	assert.equal(hintPos(GEUKKEUJE, 'ㄱ', [0, 2, 3]), -1);
	assert.equal(hintPos(GEUKKEUJE, 'ㅂ', []), -1);
});

test('parseKnown: 정수 배열만 받고 나머지는 빈 목록', () => {
	assert.deepEqual(parseKnown([0, 3]), [0, 3]);
	for (const bad of [undefined, null, 'ㄱ', 3, {}, ['0'], [1.5], [0, null]]) assert.deepEqual(parseKnown(bad), []);
});
