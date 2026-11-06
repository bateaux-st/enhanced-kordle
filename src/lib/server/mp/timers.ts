// 상태에는 마감 시각만 저장하고 알람은 가장 이른 하나만 건다. 제한 시간·등반 유예·경쟁 끊김 탈락을 여기서 처리한다.
import { EMPTY_ROOM_MS, LOBBY_REFRESH_MS, SOCKET_IDLE_MS } from '../../mp/rules.ts';
import { eliminationAt, expireCompPlayers } from './comp.ts';
import { expireDeadline } from './coop.ts';
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
	const game = s.phase === 'playing' ? s.game : null;
	if (game?.kind === 'coop' && game.status === 'playing' && game.board.deadline !== null) due.push(game.board.deadline);
	if (game?.kind === 'comp') {
		if (game.graceEnd !== null) due.push(game.graceEnd);
		for (const [pid, p] of Object.entries(game.players)) {
			if (p.status !== 'playing') continue;
			if (p.board.deadline !== null) due.push(p.board.deadline);
			const out = eliminationAt(s, pid);
			if (out !== null) due.push(out);
		}
	}
	return due.length ? Math.min(...due) : null;
}

/** 마지막 자동 응답(없으면 접속 시각)이 이 시간을 넘긴 소켓은 반쯤 끊긴 것으로 본다. */
export const isStaleSocket = (seenAt: number, now: number): boolean => now - seenAt > SOCKET_IDLE_MS;

/**
 * 소켓 정리 점검 시각. 소켓이 있을 때만 후보다.
 * 소켓별 마지막 응답 시각이 아니라 점검 주기로 잡는다: ping은 DO를 깨우지 않으므로 응답 시각에 맞추면 25초마다 알람이 울린다.
 */
export const reapCheckAt = (lastCheck: number, socketCount: number): number | null => (socketCount > 0 ? lastCheck + SOCKET_IDLE_MS : null);

/**
 * 알람을 걸 시각. 마감, Lobby 재알림, 소켓 정리 점검 중 가장 이른 것, 모두 없으면 null.
 * 재알림은 목록에 올라 있을 때만 후보다: 접속자가 없으면 syncLobby가 upsert를 하지 않아 lastUpsert가 낡은 채로 남고,
 * 그 값으로 만든 과거 시각이 후보가 되면 알람이 곧바로 다시 울리는 루프가 유예 시간 내내 돈다.
 */
export function alarmTarget(s: RoomState, lastUpsert: number, reapAt: number | null = null): number | null {
	const refreshAt = isListed(s) ? lastUpsert + LOBBY_REFRESH_MS : null;
	const cands = [nextDeadline(s), refreshAt, reapAt].filter((x): x is number => x !== null);
	return cands.length ? Math.min(...cands) : null;
}

/**
 * 걸려 있는 알람을 어떻게 할지. 'keep'은 건드리지 않음, 'delete'는 지움, 숫자는 그 시각으로 다시 건다.
 * 이미 걸린 알람이 미래이고 목표보다 이르면 둔다: 소켓 정리 점검 시각(lastReap + 45초)은 메모리 값이라 깨어날 때마다
 * 밀리는데, 덮어쓰면 방이 45초보다 자주 깨는 동안 점검 알람이 한 번도 울리지 못한다. 일찍 울린 알람은 다시 계산하면 그만이다.
 */
export function alarmChange(current: number | null, target: number | null, now: number): 'keep' | 'delete' | number {
	if (target === null) return current === null ? 'keep' : 'delete';
	if (current !== null && current > now && current <= target) return 'keep';
	return Math.max(target, now + 1);
}

/** 만료된 마감을 처리한다. 같은 now로 다시 불러도 결과가 같다. destroy면 호출자가 방을 지운다. */
export function tick(s: RoomState, now: number): { changed: boolean; destroy: boolean } {
	if (abandoned(s)) return { changed: false, destroy: true };
	if (s.emptySince !== null && now >= s.emptySince + EMPTY_ROOM_MS) return { changed: false, destroy: true };
	const succeeded = succeedHost(s, now);
	const expired = expireCompPlayers(s, now);
	const coopTimedOut = expireDeadline(s, now);
	return { changed: succeeded || expired || coopTimedOut, destroy: false };
}
