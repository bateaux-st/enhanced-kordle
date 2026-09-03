import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MIN_N, MAX_N } from '$lib/jamo';
import type { NewGameRequest, NewGameResponse } from '$lib/types';
import { answerCount, POOL_THRESHOLD } from '$lib/server/dict';
import { encodeToken, randomIndex, seededIndex, todayKST } from '$lib/server/token';

const SPAN = MAX_N - MIN_N + 1;

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as NewGameRequest | null;
	if (!body || !(body.mode in POOL_THRESHOLD)) error(400, 'bad request');
	if (body.n !== undefined && (!Number.isInteger(body.n) || body.n < MIN_N || body.n > MAX_N)) {
		error(400, `n must be ${MIN_N}..${MAX_N}`);
	}
	const t = POOL_THRESHOLD[body.mode];

	let n: number;
	let idx: number;
	if (body.mode === 'daily') {
		// n을 안 고른 데일리는 날짜로 n까지 정한다. 시드에 n을 섞어 "오늘의 6자"와 "오늘의 7자"가 서로 다른 단어가 되게 한다.
		const day = todayKST();
		n = body.n ?? MIN_N + seededIndex(`n:${day}`, SPAN);
		idx = seededIndex(`${day}:${n}`, answerCount(t, n));
	} else {
		n = body.n ?? MIN_N + randomIndex(SPAN);
		idx = randomIndex(answerCount(t, n));
	}

	const res: NewGameResponse = { token: encodeToken({ n, t, idx }), n };
	return json(res);
};
