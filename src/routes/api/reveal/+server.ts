import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RevealRequest, RevealResponse } from '$lib/types';
import { ctx } from '$lib/server/env';
import { decodeToken } from '$lib/server/token';

// 토큰만 있으면 정답을 준다. 개인 게임이라 치팅 방어보다 "실패 후 정답 보기"가 단순한 쪽을 택했다.
export const POST: RequestHandler = async ({ request, platform }) => {
	const { db, secret } = ctx(platform);
	const body = (await request.json().catch(() => null)) as RevealRequest | null;
	const answer = body && typeof body.token === 'string' ? await decodeToken(body.token, secret) : null;
	if (!answer) error(400, 'bad token');

	const res: RevealResponse = { word: (await db.answerAt(answer.t, answer.n, answer.idx)).word };
	return json(res);
};
