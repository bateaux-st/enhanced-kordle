import { createHmac, createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

// 정답은 서버에 저장하지 않는다. (n, 풀 임계값, idx)를 HMAC으로 서명해 클라이언트에 맡기고 매 요청마다 검증한다.
// 풀 임계값이 다르면 같은 idx가 다른 단어를 가리키므로 토큰에 함께 넣는다.
// 그래서 서버가 무상태라 replica를 늘려도, 재시작해도 진행 중 게임이 깨지지 않는다.
// 시크릿이 바뀌면 기존 토큰이 전부 무효가 되므로 운영에서는 KORDLE_SECRET을 고정해 주입한다.
const SECRET = env.KORDLE_SECRET ?? 'dev-only-secret';

export interface Answer {
	n: number;
	/** 정답 풀의 familiar 하한 (dict.ts POOL_THRESHOLD) */
	t: number;
	idx: number;
}

function sign(payload: string): string {
	return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function encodeToken(a: Answer): string {
	const payload = `${a.n}.${a.t}.${a.idx}`;
	return `${payload}.${sign(payload)}`;
}

export function decodeToken(token: string): Answer | null {
	const m = /^(\d+)\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
	if (!m) return null;
	const payload = `${m[1]}.${m[2]}.${m[3]}`;
	const expected = Buffer.from(sign(payload));
	const given = Buffer.from(m[4]);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	return { n: Number(m[1]), t: Number(m[2]), idx: Number(m[3]) };
}

/** 문자열 시드를 [0, max) 정수로. 날짜처럼 모든 사용자에게 같아야 하는 선택에 쓴다. */
export function seededIndex(seed: string, max: number): number {
	return createHash('sha256').update(seed).digest().readUInt32BE(0) % max;
}

export function randomIndex(max: number): number {
	return randomInt(max);
}

/** 오늘 날짜(KST) — 데일리 단어의 경계는 한국 자정이다. */
export function todayKST(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}
