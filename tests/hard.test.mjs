import assert from 'node:assert/strict';
import test from 'node:test';
import { hardViolation } from '../src/lib/hard.ts';

// 정답 바나나(ㅂㅏㄴㅏㄴㅏ)에 난방(ㄴㅏㄴㅂㅏㅇ)을 넣은 실제 판정 — HelpModal의 예와 같은 값.
const rows = ['ㄴㅏㄴㅂㅏㅇ'];
const marks = [['p', 'c', 'c', 'p', 'p', 'a']];

test('초록은 같은 자리에, 노랑은 어디든 들어 있으면 통과한다', () => {
	// 2번째 칸 ㅏ·3번째 칸 ㄴ 유지, 노랑 ㄴ·ㅂ·ㅏ 모두 포함. 회색 ㅇ은 요구하지 않는다.
	assert.equal(hardViolation(rows, marks, 'ㅁㅏㄴㅂㅜㄹ'), null);
});

test('노랑은 자모 종류만 요구하고 개수는 세지 않는다', () => {
	// 한 행에서 ㅏ가 초록·노랑으로 두 번 나왔지만 추측의 ㅏ 하나로 둘을 다 만족시킨다.
	const guess = 'ㅁㅏㄴㅂㅜㄹ';
	assert.equal([...guess].filter((j) => j === 'ㅏ').length, 1);
	assert.equal(hardViolation(rows, marks, guess), null);
});

test('초록 자리를 다르게 채우면 왼쪽 칸부터 알려준다', () => {
	// 2번째(ㅏ)·3번째(ㄴ) 둘 다 어겼을 때 먼저 고칠 칸은 2번째다.
	assert.deepEqual(hardViolation(rows, marks, 'ㅂㅜㅁㅂㅏㅇ'), { kind: 'pos', pos: 1, jamo: 'ㅏ' });
	assert.deepEqual(hardViolation(rows, marks, 'ㅁㅏㅁㅂㅜㄹ'), { kind: 'pos', pos: 2, jamo: 'ㄴ' });
});

test('노랑 자모를 빼먹으면 그 자모를 알려준다', () => {
	assert.deepEqual(hardViolation(rows, marks, 'ㅁㅏㄴㅁㅜㄹ'), { kind: 'missing', jamo: 'ㅂ' });
});

test('제약은 모든 행에 걸쳐 누적된다', () => {
	const two = [...rows, 'ㅁㅏㄴㅂㅜㄹ'];
	const twoMarks = [...marks, ['p', 'c', 'c', 'p', 'a', 'a']];
	// 둘째 행에서 ㅁ이 노랑으로 추가됐다 — 첫 행만 만족시키던 열이 이제 거부된다.
	assert.deepEqual(hardViolation(two, twoMarks, 'ㅂㅏㄴㅜㅜㅜ'), { kind: 'missing', jamo: 'ㅁ' });
	assert.equal(hardViolation(two, twoMarks, 'ㅁㅏㄴㅂㅜㅜ'), null);
});

test('첫 추측에는 제약이 없다', () => {
	assert.equal(hardViolation([], [], 'ㅋㅋㅋㅋㅋㅋ'), null);
});
