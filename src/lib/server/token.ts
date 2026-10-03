// 정답은 서버에 저장하지 않는다. (n, 풀 임계값, idx)를 HMAC으로 서명해 클라이언트에 맡기고 매 요청마다 검증한다.
// 풀 임계값이 다르면 같은 idx가 다른 단어를 가리키므로 토큰에 함께 넣는다.
// 그래서 Worker가 무상태라 어느 엣지에서 실행돼도, 몇 개가 떠도 진행 중 게임이 깨지지 않는다.
// 시크릿이 바뀌면 기존 토큰이 전부 무효가 되므로 운영에서는 KORDLE_SECRET을 고정한다(wrangler secret).
// Workers 런타임이라 node:crypto 대신 Web Crypto — 전부 비동기다.

export interface Answer {
	n: number;
	/** 정답 풀의 familiar 하한 (dict.ts POOL_THRESHOLD) */
	t: number;
	idx: number;
}

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
	let k = keyCache.get(secret);
	if (!k) {
		k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
		keyCache.set(secret, k);
	}
	return k;
}

function b64url(buf: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
	const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
	return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function encodeToken(a: Answer, secret: string): Promise<string> {
	const payload = `${a.n}.${a.t}.${a.idx}`;
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
	return `${payload}.${b64url(sig)}`;
}

export async function decodeToken(token: string, secret: string): Promise<Answer | null> {
	const m = /^(\d+)\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
	if (!m) return null;
	const payload = `${m[1]}.${m[2]}.${m[3]}`;
	let sig: Uint8Array;
	try {
		sig = fromB64url(m[4]);
	} catch {
		return null;
	}
	// subtle.verify는 상수 시간 비교다.
	const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig as BufferSource, enc.encode(payload));
	return ok ? { n: Number(m[1]), t: Number(m[2]), idx: Number(m[3]) } : null;
}

/** 문자열 시드를 [0, max) 정수로. 날짜처럼 모든 사용자에게 같아야 하는 선택에 쓴다. */
export async function seededIndex(seed: string, max: number): Promise<number> {
	const digest = await crypto.subtle.digest('SHA-256', enc.encode(seed));
	return new DataView(digest).getUint32(0) % max;
}

/**
 * 이 날짜(KST) 이상의 데일리부터 같은 (모드, n) 안에서 정답이 반복되지 않는다.
 * 시작일 이전은 과거 문제를 바꾸지 않으려고 예전 해시(날짜별 독립)를 그대로 쓴다.
 * 바꾸면 그날 데일리 정답이 바뀐다 — 절대 바꾸지 않는다.
 */
export const DAILY_DEDUP_START = '2026-10-04';

function gcd(a: number, b: number): number {
	while (b) [a, b] = [b, a % b];
	return a;
}

/**
 * 데일리 정답 idx. 시작일 이후는 (모드, n)마다 고정된 순열 idx = (a*d + b) % count 를 쓴다.
 * a가 count와 서로소면 d가 count 안에서 일 단위로 증가하는 동안 idx가 모두 다르다. 서버는 무상태라 "이미 나온 단어" 목록 대신 날짜만으로 계산한다.
 * 한계: 사전 갱신으로 count나 풀 배치가 바뀌면 순열이 새로 시작되어 이전 정답이 다시 나올 수 있고, count일이 지나면 한 바퀴 돌아 반복한다.
 * 데일리↔일일 등반 간 교차 중복은 막지 않는다.
 */
export async function dailyIndex(day: string, n: number, climb: boolean, count: number): Promise<number> {
	if (day < DAILY_DEDUP_START) return seededIndex(`${day}:${n}${climb ? ':climb' : ''}`, count);
	if (count <= 1) return 0;
	const d = Math.round((Date.parse(day) - Date.parse(DAILY_DEDUP_START)) / 86400000);
	const digest = await crypto.subtle.digest('SHA-256', enc.encode(`perm:${n}${climb ? ':climb' : ''}`));
	const view = new DataView(digest);
	let a = view.getUint32(0) % count;
	const b = view.getUint32(4) % count;
	while (a === 0 || gcd(a, count) !== 1) a = (a + 1) % count;
	// a < count(수만 이하), d는 수천 일 이하라 a*d가 2^53을 넘지 않는다.
	return (a * d + b) % count;
}

export function randomIndex(max: number): number {
	// 2^32 % max 만큼의 편향은 풀 크기(수천~수만)에서 무시할 수준이다.
	return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}
