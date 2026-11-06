// 순위. 높이는 등반에서만 비교하고 단판에서는 뺀다.
import type { Pid, Standing } from '../../mp/protocol.ts';
import type { Board, CompGame } from './state.ts';

export interface Metrics {
	height: number;
	greens: number;
	yellows: number;
	tries: number;
}

/** 초록은 행을 합친 자리 수, 노랑은 노랑을 받은 자모 종류 수(현재 스테이지 보드 기준). */
export function metrics(board: Board): Metrics {
	const greens = new Set<number>();
	const yellows = new Set<string>();
	board.rows.forEach((row, r) => {
		[...row].forEach((jamo, i) => {
			const m = board.marks[r][i];
			if (m === 'c') greens.add(i);
			else if (m === 'p') yellows.add(jamo);
		});
	});
	return { height: board.cleared, greens: greens.size, yellows: yellows.size, tries: board.rows.length };
}

/** 음수면 a가 위, 0이면 공동. */
export function cmpMetrics(a: Metrics, b: Metrics, useHeight: boolean): number {
	if (useHeight && a.height !== b.height) return b.height - a.height;
	if (a.greens !== b.greens) return b.greens - a.greens;
	if (a.yellows !== b.yellows) return b.yellows - a.yellows;
	return a.tries - b.tries;
}

/**
 * 완주·정답자 먼저, 그다음 미완주자를 지표 순으로. 앞 사람과 비교가 0이면 같은 순위(1, 2, 2, 4).
 * 입력 순서(game.players 삽입 순)가 같은 순위 안의 표시 순서다.
 */
export function standings(game: CompGame, nameOf: (pid: Pid) => string): Standing[] {
	const climb = game.settings.game === 'climb';
	const all = Object.entries(game.players);
	const done = all.filter(([, p]) => p.status === 'solved');
	const rest = all.filter(([, p]) => p.status !== 'solved');

	// 등반 완주자는 finishedAt(ms)이 아니라 finishOrder(처리 순서)로 가른다. 같은 ms에 끝나도 공동 순위가 되면 안 된다.
	const cmpDone = (a: (typeof all)[number], b: (typeof all)[number]) =>
		climb
			? game.finishOrder.indexOf(a[0]) - game.finishOrder.indexOf(b[0])
			: a[1].triesUsed - b[1].triesUsed || a[1].finishedAt! - b[1].finishedAt!;
	const cmpRest = (a: (typeof all)[number], b: (typeof all)[number]) => cmpMetrics(metrics(a[1].board), metrics(b[1].board), climb);

	const out: Standing[] = [];
	const place = (sorted: typeof all, cmp: typeof cmpDone, solved: boolean) => {
		sorted.forEach((entry, i) => {
			const prev = sorted[i - 1];
			const tiedWithPrev = prev !== undefined && cmp(prev, entry) === 0;
			out.push({
				pid: entry[0],
				name: nameOf(entry[0]),
				rank: tiedWithPrev ? out[out.length - 1].rank : out.length + 1,
				tied: false,
				status: entry[1].status,
				tries: entry[1].board.rows.length,
				finishOrder: solved ? i + 1 : null
			});
		});
	};
	place([...done].sort(cmpDone), cmpDone, true);
	place([...rest].sort(cmpRest), cmpRest, false);

	for (let i = 0; i < out.length; i++) {
		out[i].tied = out[i - 1]?.rank === out[i].rank || out[i + 1]?.rank === out[i].rank;
	}
	return out;
}
