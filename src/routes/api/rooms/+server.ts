import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// 공개 방 목록. 첫 로드·새로고침·WS가 끊긴 동안의 폴링이 부르므로 캐시하지 않는다.
export const GET: RequestHandler = async ({ platform }) => {
	const env = platform?.env;
	if (!env?.LOBBY) error(503, 'platform bindings not available');
	const rooms = await env.LOBBY.get(env.LOBBY.idFromName('lobby')).list();
	return json(rooms, { headers: { 'cache-control': 'no-store' } });
};
