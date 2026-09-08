import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isJamo } from '$lib/jamo';
import type { HintRequest, HintResponse } from '$lib/types';
import { ctx } from '$lib/server/env';
import { decodeToken } from '$lib/server/token';

// 노란 판정(자모는 있지만 자리가 다름)을 받은 자모의 실제 첫 위치를 알려준다.
// 클라이언트가 어떤 자모를 물을지 고르고, 서버는 정답만 보고 답한다 — 서버는 진행 상태를 모른다.
export const POST: RequestHandler = async ({ request, platform }) => {
	const { db, secret } = ctx(platform);
	const body = (await request.json().catch(() => null)) as HintRequest | null;
	const answer = body && typeof body.token === 'string' ? await decodeToken(body.token, secret) : null;
	if (!answer) error(400, 'bad token');
	if (!isJamo(body!.jamo)) error(400, 'bad jamo');

	const pos = (await db.answerAt(answer.t, answer.n, answer.idx)).jamo.indexOf(body!.jamo);
	if (pos < 0) error(400, 'jamo not in answer');
	return json({ pos } satisfies HintResponse);
};
