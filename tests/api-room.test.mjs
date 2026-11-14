import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_RE, DEFAULT_SETTINGS, SESSION_TTL_MS } from '../src/lib/mp/rules.ts';
import { issue, verify } from '../src/lib/server/mp/session.ts';
import { call, fakeNs, loadRoute, platformOf } from './route-runtime.mjs';

const { POST } = await loadRoute('api/room');

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000;
const NAME = '철수입니다';
const COOP = { kind: 'coop', game: 'climb', length: 'random', tries: 8, hard: true, hints: false, timer: true, pick: 'roulette' };

/** init이 results를 차례로 돌려주는 ROOM. 다 쓰면 true. */
function roomNs(results = []) {
	const ns = fakeNs(() => ({ init: async () => (results.length ? results.shift() : true) }));
	return ns;
}

const setup = (t, results, env = {}) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	const ns = roomNs(results);
	return { ns, platform: platformOf({ ROOM: ns, ...env }) };
};

test('방을 예약하고 코드와 세션을 돌려준다: init(code, {uid, name}, 기본 설정)', async (t) => {
	const { ns, platform } = setup(t);
	const res = await call(POST, { body: { name: NAME }, platform });
	assert.equal(res.status, 200);
	const { code, session } = res.json;
	assert.match(code, CODE_RE);
	assert.deepEqual(ns.names, [code]);
	assert.equal(ns.calls.length, 1);
	const [initCode, creator, settings] = ns.calls[0].args;
	assert.equal(initCode, code);
	assert.deepEqual(settings, DEFAULT_SETTINGS);
	assert.deepEqual(Object.keys(res.json).sort(), ['code', 'session']);
	assert.equal(session.exp, NOW + SESSION_TTL_MS);
	const verified = await verify(session.token, NOW, SECRET);
	assert.deepEqual([verified.uid, verified.name], [creator.uid, NAME]);
	assert.equal(creator.name, NAME);
});

test('settings를 주면 검증·복사해 init에 넘기고, 모르는 필드는 버린다', async (t) => {
	const { ns, platform } = setup(t);
	assert.equal((await call(POST, { body: { name: NAME, settings: { ...COOP, extra: 'x' } }, platform })).status, 200);
	assert.deepEqual(ns.calls[0].args[2], COOP);
});

test('이름은 정규화해 쓴다(앞뒤 공백 제거, NFC)', async (t) => {
	const { ns, platform } = setup(t);
	const res = await call(POST, { body: { name: `  ${'한국어입니다'.normalize('NFD')}  ` }, platform });
	assert.equal(ns.calls[0].args[1].name, '한국어입니다');
	assert.equal((await verify(res.json.session.token, NOW, SECRET)).name, '한국어입니다');
});

test('유효한 토큰이면 같은 uid로 이어 받고, 없거나 위조·만료면 새 uid', async (t) => {
	const { ns, platform } = setup(t);
	const old = await issue(undefined, NAME, NOW - 3600_000, SECRET);
	const res = await call(POST, { body: { name: NAME, token: old.token }, platform });
	assert.equal(ns.calls[0].args[1].uid, old.uid);
	assert.equal(res.json.session.exp, NOW + SESSION_TTL_MS, '슬라이딩으로 만료가 갱신된다');

	const expired = await issue(undefined, NAME, NOW - SESSION_TTL_MS - 5000, SECRET);
	for (const token of [expired.token, `${old.token}x`, 'garbage', (await issue(undefined, NAME, NOW, 'other-secret')).token]) {
		ns.calls.length = 0;
		assert.equal((await call(POST, { body: { name: NAME, token }, platform })).status, 200);
		assert.notEqual(ns.calls[0].args[1].uid, old.uid);
	}
});

test('입력 검사 순서: 이름, 토큰 형식, 설정. 어느 것이든 방을 만들지 않는다', async (t) => {
	const { ns, platform } = setup(t);
	const cases = [
		[{ raw: 'not json' }, 'bad name'],
		[{ raw: 'null' }, 'bad name'],
		[{ body: {} }, 'bad name'],
		[{ body: { name: 5 } }, 'bad name'],
		[{ body: { name: '가나다라' } }, 'bad name'],
		[{ body: { name: '가'.repeat(13) } }, 'bad name'],
		[{ body: { name: NAME, token: 5 } }, 'bad token'],
		[{ body: { name: NAME, token: null } }, 'bad token'],
		[{ body: { name: NAME, token: ['x'] } }, 'bad token'],
		[{ body: { name: NAME, settings: null } }, 'bad settings'],
		[{ body: { name: NAME, settings: {} } }, 'bad settings'],
		[{ body: { name: NAME, settings: { ...COOP, tries: 11 } } }, 'bad settings'],
		[{ body: { name: NAME, settings: { ...COOP, length: 4 } } }, 'bad settings'],
		[{ body: { name: NAME, token: 5, settings: null } }, 'bad token'],
		[{ body: { name: 'x', token: 5, settings: null } }, 'bad name']
	];
	for (const [input, message] of cases) {
		const res = await call(POST, { ...input, platform });
		assert.deepEqual([res.status, res.message], [400, message], JSON.stringify(input));
	}
	assert.equal(ns.calls.length, 0);
});

test('코드가 이미 쓰이고 있으면(init이 false) 새 코드로 다시 시도한다', async (t) => {
	const { ns, platform } = setup(t, [false, false, true]);
	const res = await call(POST, { body: { name: NAME }, platform });
	assert.equal(res.status, 200);
	assert.equal(ns.calls.length, 3);
	assert.equal(res.json.code, ns.calls[2].args[0]);
	assert.ok(ns.calls.every((c) => CODE_RE.test(c.args[0])));
	assert.deepEqual(ns.names, ns.calls.map((c) => c.args[0]));
	assert.ok(ns.calls.every((c) => c.args[1].uid === ns.calls[0].args[1].uid), '재시도에서도 같은 세션 uid');
});

test('5번 모두 코드가 쓰이고 있으면 503 could not allocate a room code', async (t) => {
	const { ns, platform } = setup(t, [false, false, false, false, false, true]);
	const res = await call(POST, { body: { name: NAME }, platform });
	assert.deepEqual([res.status, res.message], [503, 'could not allocate a room code']);
	assert.equal(ns.calls.length, 5);
});

test('코드는 난수로 정한다: 난수 n개가 알파벳의 n번째 글자가 된다(0 O 1 I 제외 32자)', async (t) => {
	const { ns, platform } = setup(t);
	const real = crypto.getRandomValues.bind(crypto);
	const draws = [0, 1, 2, 3, 4, 31];
	t.mock.method(crypto, 'getRandomValues', (arr) => (arr instanceof Uint32Array ? ((arr[0] = draws.shift()), arr) : real(arr)));
	const res = await call(POST, { body: { name: NAME }, platform });
	assert.equal(res.json.code, 'ABCDE9');
	assert.equal(ns.names[0], 'ABCDE9');
});

test('ROOM 바인딩이 없으면 본문을 읽기 전에 503', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	for (const platform of [undefined, { env: {} }, platformOf({ ROOM: undefined })]) {
		const res = await call(POST, { body: { name: NAME }, platform });
		assert.deepEqual([res.status, res.message], [503, 'platform bindings not available']);
	}
});

test('KORDLE_SECRET이 없으면 dev 기본값으로 서명하고, DO 호출이 실패하면 던져진다', async (t) => {
	const { platform } = setup(t, [], { KORDLE_SECRET: undefined });
	const res = await call(POST, { body: { name: NAME }, platform });
	assert.ok(await verify(res.json.session.token, NOW, 'dev-only-secret'));
	assert.equal(await verify(res.json.session.token, NOW, SECRET), null);

	const broken = fakeNs(() => ({
		init: async () => {
			throw new Error('do down');
		}
	}));
	const failed = await call(POST, { body: { name: NAME }, platform: platformOf({ ROOM: broken }) });
	assert.equal(failed.status, 500);
	assert.equal(failed.crashed.message, 'do down');
});
