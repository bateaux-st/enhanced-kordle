// 임시 계정 토큰: mp1.<uid>.<name>.<iat>.<sig>. 서버 저장 없이 HMAC 서명만으로 검증한다.
// 개인 모드 정답 토큰(n.t.idx)과는 mp1. 접두어로 갈라진다. 시각(now)과 시크릿은 인자로 받는다.
import { normalizeName, SESSION_TTL_MS } from '../../mp/rules.ts';

export interface Session {
	token: string;
	uid: string;
	name: string;
	/** 만료 시각(ms) = 발급 시각 + 24시간. */
	exp: number;
}

const PREFIX = 'mp1';
const SIG_LEN = 32;
const UID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
	let k = keyCache.get(secret);
	if (!k) {
		k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		keyCache.set(secret, k);
	}
	return k;
}

function toB64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sign(secret: string, payload: string): Promise<string> {
	const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
	return toB64url(new Uint8Array(mac)).slice(0, SIG_LEN);
}

/** 길이가 같은 문자열을 끝까지 비교한다. */
function sameSig(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

const newUid = (): string => toB64url(crypto.getRandomValues(new Uint8Array(16)));

async function build(uid: string, name: string, now: number, secret: string): Promise<Session> {
	const iat = Math.floor(now / 1000);
	const payload = `${PREFIX}.${uid}.${toB64url(enc.encode(name))}.${iat}`;
	return { token: `${payload}.${await sign(secret, payload)}`, uid, name, exp: iat * 1000 + SESSION_TTL_MS };
}

/** 새 토큰. uid를 주면 유지하고 없으면 새로 만든다. name이 규칙(1..12자)에 안 맞으면 던진다. */
export async function issue(uid: string | undefined, rawName: string, now: number, secret: string): Promise<Session> {
	const name = normalizeName(rawName);
	if (name === null) throw new RangeError('bad name');
	return build(uid ?? newUid(), name, now, secret);
}

/** 서명과 형식이 맞고 마지막 발급 후 24시간 이내면 내용을 돌려준다. */
export async function verify(token: unknown, now: number, secret: string): Promise<{ uid: string; name: string; iat: number } | null> {
	if (typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 5 || parts[0] !== PREFIX) return null;
	const [, uid, nameB64, iatStr, sig] = parts;
	if (!UID_RE.test(uid) || !B64URL_RE.test(nameB64) || !/^\d{1,12}$/.test(iatStr) || sig.length !== SIG_LEN) return null;

	let name: string | null;
	try {
		name = normalizeName(new TextDecoder('utf-8', { fatal: true }).decode(fromB64url(nameB64)));
	} catch {
		return null;
	}
	// 정규화 결과가 토큰의 원문과 다르면 이 서버가 발급한 형태가 아니다.
	if (name === null || toB64url(enc.encode(name)) !== nameB64) return null;

	if (!sameSig(await sign(secret, `${PREFIX}.${uid}.${nameB64}.${iatStr}`), sig)) return null;
	const iat = Number(iatStr);
	if (now - iat * 1000 > SESSION_TTL_MS) return null;
	return { uid, name, iat };
}

/**
 * hello마다 부른다. 유효한 토큰이면 같은 uid로 iat를 now로 갱신해(슬라이딩) 이름을 새로 서명하고,
 * 없음·만료·변조면 거절하지 않고 새 uid로 발급한다.
 */
export async function refresh(token: unknown, rawName: string, now: number, secret: string): Promise<Session> {
	const current = await verify(token, now, secret);
	return issue(current?.uid, rawName, now, secret);
}
