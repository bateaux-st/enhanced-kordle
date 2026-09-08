import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MIN_N, MAX_N } from '$lib/jamo';
import type { NewGameRequest, NewGameResponse } from '$lib/types';
import { POOL_THRESHOLD } from '$lib/server/dict';
import { ctx } from '$lib/server/env';
import { encodeToken, randomIndex, seededIndex } from '$lib/server/token';
import { todayKST } from '$lib/day';

const SPAN = MAX_N - MIN_N + 1;

export const POST: RequestHandler = async ({ request, platform }) => {
	const { db, secret } = ctx(platform);
	const body = (await request.json().catch(() => null)) as NewGameRequest | null;
	if (!body || !(body.mode in POOL_THRESHOLD)) error(400, 'bad request');
	if (body.n !== undefined && (!Number.isInteger(body.n) || body.n < MIN_N || body.n > MAX_N)) {
		error(400, `n must be ${MIN_N}..${MAX_N}`);
	}
	const t = POOL_THRESHOLD[body.mode];

	let n: number;
	let idx: number;
	if (body.mode === 'daily' || body.mode === 'daily-climb') {
		// n을 안 고른 데일리는 날짜로 n까지 정한다. 시드에 n을 섞어 "오늘의 6자"와 "오늘의 7자"가 서로 다른 단어가 되게 한다.
		// 일일 등반은 시드에 모드를 섞어 데일리 n자와 다른 단어가 나오게 한다 — 안 그러면 등반 6자가 데일리 6자의 스포일러다.
		const day = todayKST();
		n = body.n ?? MIN_N + (await seededIndex(`n:${day}`, SPAN));
		idx = await seededIndex(`${day}:${n}${body.mode === 'daily-climb' ? ':climb' : ''}`, await db.answerCount(t, n));
	} else {
		n = body.n ?? MIN_N + randomIndex(SPAN);
		idx = randomIndex(await db.answerCount(t, n));
	}

	const res: NewGameResponse = { token: await encodeToken({ n, t, idx }, secret), n };
	return json(res);
};
