import assert from 'node:assert/strict';
import test from 'node:test';
import { judge } from '../src/lib/server/judge.ts';
import { encodeToken, decodeToken } from '../src/lib/server/token.ts';

test('중복 자모는 정확한 자리를 먼저 확보하고 남은 개수만 배분한다', () => {
	assert.deepEqual(judge('ㄱㅏㄱㅅㅣ', 'ㄱㄱㄱㅏㅏ'), ['c', 'a', 'c', 'p', 'a']);
	assert.deepEqual(judge('ㅂㅏㄴㅏㄴㅏ', 'ㄴㅏㄴㅂㅏㅇ'), ['p', 'c', 'c', 'p', 'p', 'a']);
	assert.deepEqual(judge('ㅂㅏㄴㅏㄴㅏ', 'ㅂㅏㄴㅏㄴㅏ'), Array(6).fill('c'));
	assert.deepEqual(judge('ㅂㅏㄴㅏㄴㅏ', 'ㅋㅋㅋㅋㅋㅋ'), Array(6).fill('a'));
});

test('토큰은 정답 좌표를 복원하며 좌표 변조와 다른 시크릿을 거부한다', async () => {
	const answer = { n: 6, t: 2, idx: 17 };
	const token = await encodeToken(answer, 'test-only-secret');
	assert.match(token, /^6\.2\.17\.[A-Za-z0-9_-]+$/);
	assert.deepEqual(await decodeToken(token, 'test-only-secret'), answer);
	for (const payload of ['7.2.17', '6.3.17', '6.2.18']) {
		assert.equal(await decodeToken(`${payload}.${token.split('.')[3]}`, 'test-only-secret'), null);
	}
	assert.equal(await decodeToken(token, 'different-test-secret'), null);
	assert.equal(await decodeToken('6.17.AAAA', 'test-only-secret'), null);
	assert.equal(await decodeToken('invalid', 'test-only-secret'), null);
});
