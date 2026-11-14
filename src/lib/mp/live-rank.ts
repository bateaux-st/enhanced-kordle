import type { Standing } from './protocol.ts';

export interface LiveRow {
	s: Standing;
	/** 확정 행의 순위 숫자. 풀이 중이면 null. */
	shown: number | null;
	tied: boolean;
}

/**
 * 서버 순위표는 풀이 중인 사람도 지표로 줄을 세운다. 그 숫자는 그 사람이 끝나면 바뀔 수 있어서,
 * 끝난 사람끼리만 순위 숫자를 다시 매기고(공동은 1, 1, 3) 풀이 중인 사람은 숫자 없이 아래에 서버 순서대로 둔다.
 */
export function liveRows(standings: Standing[]): LiveRow[] {
	const done = standings.filter((s) => s.status !== 'playing');
	return [
		...done.map((s) => ({
			s,
			shown: done.findIndex((x) => x.rank === s.rank) + 1,
			tied: done.filter((x) => x.rank === s.rank).length > 1
		})),
		...standings.filter((s) => s.status === 'playing').map((s) => ({ s, shown: null, tied: false }))
	];
}
