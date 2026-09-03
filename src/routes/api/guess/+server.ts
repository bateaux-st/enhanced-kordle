import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isJamo } from '$lib/jamo';
import type { GuessRequest, GuessResponse } from '$lib/types';
import { answerAt, isValidJamo } from '$lib/server/dict';
import { judge } from '$lib/server/judge';
import { decodeToken } from '$lib/server/token';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as GuessRequest | null;
	const answer = body && typeof body.token === 'string' ? decodeToken(body.token) : null;
	if (!answer) error(400, 'bad token');

	const guess = body!.jamo;
	if (typeof guess !== 'string' || guess.length !== answer.n || ![...guess].every(isJamo)) {
		error(400, 'bad guess');
	}

	if (!isValidJamo(guess)) {
		return json({ ok: false, reason: 'invalid' } satisfies GuessResponse);
	}
	const marks = judge(answerAt(answer.t, answer.n, answer.idx).jamo, guess);
	return json({ ok: true, marks } satisfies GuessResponse);
};
