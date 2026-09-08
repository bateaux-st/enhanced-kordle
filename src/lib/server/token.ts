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

export function randomIndex(max: number): number {
	// 2^32 % max 만큼의 편향은 풀 크기(수천~수만)에서 무시할 수준이다.
	return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}
