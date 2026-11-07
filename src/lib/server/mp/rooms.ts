// 공개 방 목록의 순수 부분: Room 상태 -> 요약, Lobby 저장소 -> 정렬된 목록.
import { LOBBY_LIST_MAX, LOBBY_STALE_MS, MAX_PLAYERS } from '../../mp/rules.ts';
import type { RoomSummary } from '../../mp/protocol.ts';
import { connectedCount } from './members.ts';
import type { RoomState } from './state.ts';

/** 접속자가 있는 방만 목록에 낸다. 모두 떠난 방은 재입장 유예 동안 Room에는 남아도 목록에서는 사라진다. */
export const isListed = (s: RoomState): boolean => connectedCount(s) > 0;

export function summarize(s: RoomState, now: number): RoomSummary {
	return {
		code: s.code,
		host: s.players.find((p) => p.pid === s.hostPid)?.name ?? '',
		kind: s.settings.kind,
		game: s.settings.game,
		players: connectedCount(s),
		max: MAX_PLAYERS,
		inProgress: s.phase === 'playing',
		updatedAt: now
	};
}

/** updatedAt은 매번 달라지므로 빼고 비교한다. Room이 바뀐 때만 Lobby를 부르려는 용도. */
export function sameSummary(a: RoomSummary, b: RoomSummary): boolean {
	return a.code === b.code && a.host === b.host && a.kind === b.kind && a.game === b.game && a.players === b.players && a.max === b.max && a.inProgress === b.inProgress;
}

const joinable = (r: RoomSummary) => !r.inProgress && r.players < r.max;

/** 오래된 항목을 rooms에서 지우고(지웠으면 pruned), 입장 가능한 방 먼저, 최신순, 최대 50개. */
export function listRooms(rooms: Record<string, RoomSummary>, now: number): { list: RoomSummary[]; pruned: boolean } {
	let pruned = false;
	for (const [code, r] of Object.entries(rooms)) {
		if (now - r.updatedAt > LOBBY_STALE_MS) {
			delete rooms[code];
			pruned = true;
		}
	}
	const list = Object.values(rooms)
		.sort((a, b) => Number(joinable(b)) - Number(joinable(a)) || b.updatedAt - a.updatedAt)
		.slice(0, LOBBY_LIST_MAX);
	return { list, pruned };
}

/**
 * 구독자에게 이미 보낸 목록과 같은지. 방 집합과 항목 내용만 본다.
 * 정렬이 updatedAt 순이라 순서까지 비교하면 방이 둘 이상일 때 심장박동마다 푸시가 나간다.
 */
export function sameList(a: RoomSummary[], b: RoomSummary[]): boolean {
	if (a.length !== b.length) return false;
	const byCode = new Map(b.map((r) => [r.code, r]));
	return a.every((r) => {
		const o = byCode.get(r.code);
		return o !== undefined && sameSummary(r, o);
	});
}

/** 시간이 지나기만 해도 목록에서 빠지는 가장 이른 시각(listRooms의 `>` 기준이라 1ms 뒤). 방이 없으면 null. */
export function nextStaleAt(rooms: Record<string, RoomSummary>): number | null {
	const times = Object.values(rooms).map((r) => r.updatedAt + LOBBY_STALE_MS + 1);
	return times.length ? Math.min(...times) : null;
}
