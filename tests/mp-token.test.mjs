import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_TTL_MS } from '../src/lib/mp/rules.ts';
import { issue, refresh, verify } from '../src/lib/server/mp/session.ts';

const SECRET = 'test-only-secret';
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

test('형식: mp1.<uid 22자>.<이름>.<iat 초>.<sig 32자>', async () => {
	const s = await issue(undefined, '철수', NOW, SECRET);
	assert.match(s.token, /^mp1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]{32}$/);
	assert.equal(s.token.split('.')[3], String(NOW / 1000));
	assert.equal(s.uid.length, 22);
	assert.equal(s.exp, NOW + SESSION_TTL_MS);
});

test('발급한 토큰은 검증되고 uid·이름·iat가 왕복한다(한글 이름 포함)', async () => {
	const s = await issue(undefined, '  홍길동  ', NOW, SECRET);
	assert.deepEqual(await verify(s.token, NOW + 1000, SECRET), { uid: s.uid, name: '홍길동', iat: NOW / 1000 });
	const emoji = await issue(undefined, '곰🐻', NOW, SECRET);
	assert.equal((await verify(emoji.token, NOW, SECRET)).name, '곰🐻');
});

test('같은 uid를 주면 유지하고 없으면 매번 다른 uid', async () => {
	const a = await issue(undefined, '가', NOW, SECRET);
	const b = await issue(undefined, '가', NOW, SECRET);
	assert.notEqual(a.uid, b.uid);
	assert.equal((await issue(a.uid, '나', NOW, SECRET)).uid, a.uid);
});

test('이름 규칙: NFC로 정규화하고 비었거나 12자를 넘으면 발급을 거부한다', async () => {
	const decomposed = '한'; // 한 (NFD)
	const s = await issue(undefined, decomposed, NOW, SECRET);
	assert.equal((await verify(s.token, NOW, SECRET)).name, '한');
	assert.equal((await issue(undefined, '가'.repeat(12), NOW, SECRET)).name.length, 12);
	await assert.rejects(issue(undefined, '가'.repeat(13), NOW, SECRET), RangeError);
	await assert.rejects(issue(undefined, '   ', NOW, SECRET), RangeError);
});

test('변조: 이름·iat·uid·서명 어느 하나를 바꿔도 거절한다', async () => {
	const { token } = await issue(undefined, '철수', NOW, SECRET);
	const [p, uid, name, iat, sig] = token.split('.');
	const other = await issue(undefined, '영희', NOW, SECRET);
	const swapped = [
		[p, uid, other.token.split('.')[2], iat, sig],
		[p, uid, name, String(Number(iat) + 1), sig],
		[p, other.uid, name, iat, sig],
		[p, uid, name, iat, (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)]
	];
	for (const parts of swapped) assert.equal(await verify(parts.join('.'), NOW, SECRET), null, parts.join('.'));
	assert.equal(await verify(token, NOW, 'different-secret'), null);
});

test('mp1.이 아닌 접두어와 깨진 형식은 거절한다(개인 정답 토큰 포함)', async () => {
	const { token } = await issue(undefined, '철수', NOW, SECRET);
	assert.equal(await verify('6.2.17.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', NOW, SECRET), null);
	assert.equal(await verify(token.replace(/^mp1/, 'mp2'), NOW, SECRET), null);
	assert.equal(await verify(token + '.x', NOW, SECRET), null);
	assert.equal(await verify(token.split('.').slice(0, 4).join('.'), NOW, SECRET), null);
	for (const bad of ['', 'invalid', undefined, null, 42, {}]) assert.equal(await verify(bad, NOW, SECRET), null);
});

test('만료: 발급 24시간째까지 유효하고 24시간 1초 뒤부터 거절', async () => {
	const { token } = await issue(undefined, '철수', NOW, SECRET);
	assert.ok(await verify(token, NOW + 24 * HOUR, SECRET));
	assert.equal(await verify(token, NOW + 24 * HOUR + 1000, SECRET), null);
});

test('슬라이딩 재발급: iat가 now로 갱신되고 uid는 유지, 갱신한 토큰은 다시 24시간', async () => {
	const first = await issue(undefined, '철수', NOW, SECRET);
	const later = NOW + 20 * HOUR;
	const again = await refresh(first.token, '철수', later, SECRET);
	assert.equal(again.uid, first.uid);
	assert.equal(again.exp, later + SESSION_TTL_MS);
	assert.equal((await verify(again.token, later + 24 * HOUR, SECRET)).uid, first.uid);
	assert.equal(await verify(first.token, later + 5 * HOUR, SECRET), null, '옛 토큰은 자기 iat 기준으로 만료');
});

test('이름을 바꿔 재발급해도 uid는 그대로', async () => {
	const first = await issue(undefined, '철수', NOW, SECRET);
	const renamed = await refresh(first.token, '영희', NOW + 1000, SECRET);
	assert.equal(renamed.uid, first.uid);
	assert.equal(renamed.name, '영희');
	assert.equal((await verify(renamed.token, NOW + 1000, SECRET)).name, '영희');
});

test('토큰이 없거나 만료·변조면 거절하지 않고 새 uid로 발급한다', async () => {
	const first = await issue(undefined, '철수', NOW, SECRET);
	const tampered = first.token.slice(0, -1) + (first.token.endsWith('A') ? 'B' : 'A');
	for (const token of [undefined, '', 'garbage', tampered, first.token]) {
		const now = token === first.token ? NOW + 25 * HOUR : NOW;
		const s = await refresh(token, '철수', now, SECRET);
		assert.notEqual(s.uid, first.uid);
		assert.ok(await verify(s.token, now, SECRET));
	}
});
