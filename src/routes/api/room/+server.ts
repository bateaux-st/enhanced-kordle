import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DEFAULT_SETTINGS, normalizeName, parseSettings } from '$lib/mp/rules';
import type { CreateRoomRequest, CreateRoomResponse } from '$lib/mp/protocol';
import { newCode } from '$lib/server/mp/code';
import { mpSecret } from '$lib/server/mp/secret';
import { refresh } from '$lib/server/mp/session';
import { randomIndex } from '$lib/server/token';

const MAX_ATTEMPTS = 5;

// 방 생성: 임시 계정 토큰을 확인·발급하고, 빈 코드를 찾아 Room을 예약한다. 생성자는 방장 자리를 예약한 채 WS로 들어온다.
export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform?.env;
	if (!env?.ROOM) error(503, 'platform bindings not available');

	const body = (await request.json().catch(() => null)) as Partial<CreateRoomRequest> | null;
	const name = normalizeName(body?.name);
	if (!name) error(400, 'bad name');
	if (body?.token !== undefined && typeof body.token !== 'string') error(400, 'bad token');
	const settings = body?.settings === undefined ? DEFAULT_SETTINGS : parseSettings(body.settings);
	if (!settings) error(400, 'bad settings');

	const session = await refresh(body?.token, name, Date.now(), mpSecret(env.KORDLE_SECRET));
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		const code = newCode(randomIndex);
		if (await env.ROOM.get(env.ROOM.idFromName(code)).init(code, { uid: session.uid, name }, settings)) {
			return json({ code, session: { token: session.token, exp: session.exp } } satisfies CreateRoomResponse);
		}
	}
	error(503, 'could not allocate a room code');
};
