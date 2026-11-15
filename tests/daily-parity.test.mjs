import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dailyIndex } from '../src/lib/server/token.ts';

// scripts/smoke.py daily_idx 가 같은 파일로 검증된다 (tests/test_smoke_parity.py). 한쪽만 바뀌면 둘 중 하나가 깨진다.
const vectors = JSON.parse(readFileSync(new URL('./daily-vectors.json', import.meta.url), 'utf8'));

test('dailyIndex는 smoke.py와 공유하는 고정 벡터와 같은 idx를 낸다', async () => {
	assert.ok(vectors.length > 0);
	for (const v of vectors) {
		assert.equal(await dailyIndex(v.day, v.n, v.climb, v.count), v.idx, JSON.stringify(v));
	}
});
