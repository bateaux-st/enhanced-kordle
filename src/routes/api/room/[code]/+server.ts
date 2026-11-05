import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isCode } from '$lib/server/mp/code';

// 입장 전 확인용 방 요약. 없는 방은 404.
export const GET: RequestHandler = async ({ params, platform }) => {
	const env = platform?.env;
	if (!env?.ROOM) error(503, 'platform bindings not available');
	if (!isCode(params.code)) error(404, 'no such room');
	const info = await env.ROOM.get(env.ROOM.idFromName(params.code)).info();
	if (!info) error(404, 'no such room');
	return json(info, { headers: { 'cache-control': 'no-store' } });
};
