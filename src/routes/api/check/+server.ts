import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isJamo, MAX_N, MIN_N } from '$lib/jamo';
import type { CheckRequest, CheckResponse } from '$lib/types';
import { isValidJamo } from '$lib/server/dict';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as CheckRequest | null;
	const jamo = body?.jamo;
	if (typeof jamo !== 'string' || jamo.length < MIN_N || jamo.length > MAX_N || ![...jamo].every(isJamo)) {
		error(400, 'bad jamo');
	}
	return json({ valid: isValidJamo(jamo) } satisfies CheckResponse);
};
