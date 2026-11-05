// 상태에는 마감 시각만 저장하고 알람은 가장 이른 하나만 건다. 제한 시간·끊김 탈락은 5단계에서 이 파일에 더한다.
import { EMPTY_ROOM_MS, LOBBY_REFRESH_MS } from '../../mp/rules.ts';
import { hostSuccessionAt, succeedHost } from './members.ts';
import { isListed } from './rooms.ts';
import type { RoomState } from './state.ts';

/** 자리가 하나도 없다: 전원이 나가기로 떠났다. 끊김이 하나라도 섞이면 자리가 남아 해당하지 않는다. */
export const abandoned = (s: RoomState): boolean => s.players.length === 0;

/** 다음 알람 시각. 걸 마감이 없으면 null. */
export function nextDeadline(s: RoomState): number | null {
	const due: number[] = [];
	if (s.emptySince !== null) due.push(s.emptySince + EMPTY_ROOM_MS);
	const succession = hostSuccessionAt(s);
	if (succession !== null) due.push(succession);
	return due.length ? Math.min(...due) : null;
}

/**
 * 알람을 걸 시각. 마감과 Lobby 재알림 중 이른 것, 둘 다 없으면 null.
 * 재알림은 목록에 올라 있을 때만 후보다: 접속자가 없으면 syncLobby가 upsert를 하지 않아 lastUpsert가 낡은 채로 남고,
 * 그 값으로 만든 과거 시각이 후보가 되면 알람이 곧바로 다시 울리는 루프가 유예 시간 내내 돈다.
 */
export function alarmTarget(s: RoomState, lastUpsert: number): number | null {
	const due = nextDeadline(s);
	const refreshAt = isListed(s) ? lastUpsert + LOBBY_REFRESH_MS : null;
	if (due === null) return refreshAt;
	return refreshAt === null ? due : Math.min(due, refreshAt);
}

/** 만료된 마감을 처리한다. 같은 now로 다시 불러도 결과가 같다. destroy면 호출자가 방을 지운다. */
export function tick(s: RoomState, now: number): { changed: boolean; destroy: boolean } {
	if (abandoned(s)) return { changed: false, destroy: true };
	if (s.emptySince !== null && now >= s.emptySince + EMPTY_ROOM_MS) return { changed: false, destroy: true };
	return { changed: succeedHost(s, now), destroy: false };
}
