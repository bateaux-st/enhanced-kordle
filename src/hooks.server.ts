import type { Handle } from '@sveltejs/kit';
import { LOBBY_WS_PATH } from '$lib/mp/rules';

const WS_PATH = /^\/ws\/([^/]+)$/;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === LOBBY_WS_PATH) {
		if (event.request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}
		const lobby = event.platform?.env?.LOBBY;
		if (!lobby) return new Response('Durable Object binding not available', { status: 503 });
		return lobby.get(lobby.idFromName('lobby')).fetch(event.request);
	}

	const m = WS_PATH.exec(event.url.pathname);
	if (!m) return resolve(event);

	if (!ROOM_CODE.test(m[1])) return new Response('Not found', { status: 404 });
	if (event.request.headers.get('Upgrade') !== 'websocket') {
		return new Response('Expected WebSocket upgrade', { status: 426 });
	}
	const env = event.platform?.env;
	if (!env?.ROOM) return new Response('Durable Object binding not available', { status: 503 });

	// resolve를 거치면 SvelteKit이 응답을 가공하므로 101은 스텁 응답을 그대로 돌려준다.
	return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(event.request);
};
