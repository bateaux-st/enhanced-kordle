import type { CreateRoomRequest, CreateRoomResponse, RoomSummary } from './protocol.ts';

async function failure(res: Response): Promise<Error> {
	return new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
}

export async function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
	const res = await fetch('/api/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
	if (!res.ok) throw await failure(res);
	return (await res.json()) as CreateRoomResponse;
}

export async function listRooms(): Promise<RoomSummary[]> {
	const res = await fetch('/api/rooms', { cache: 'no-store' });
	if (!res.ok) throw await failure(res);
	return (await res.json()) as RoomSummary[];
}

/** 입장 전 확인. 없는 방이면 null. */
export async function roomInfo(code: string): Promise<RoomSummary | null> {
	const res = await fetch(`/api/room/${encodeURIComponent(code)}`, { cache: 'no-store' });
	if (res.status === 404) return null;
	if (!res.ok) throw await failure(res);
	return (await res.json()) as RoomSummary;
}
