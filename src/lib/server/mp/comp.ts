// 경쟁 단판. 같은 정답을 각자 개인 보드로 푼다. 제한 시간·등반·유예는 뒤 단계에서 더한다.
import { judge } from '../judge.ts';
import { hardViolation } from '../../hard.ts';
import { isJamo } from '../../jamo.ts';
import { LENGTH_MAX, LENGTH_MIN } from '../../mp/rules.ts';
import type { Mark } from '../../types.ts';
import type { Pid, Settings } from '../../mp/protocol.ts';
import { findPlayer } from './members.ts';
import { standings } from './rank.ts';
import { fail } from './state.ts';
import type { Answer, Board, CompGame, CompPlayer, Result, Rng, RoomState } from './state.ts';

/** 시작 길이. 'random'이면 5..12에서 하나. DO 셸이 이 값으로 D1에서 정답을 읽어 startGame에 넘긴다. */
export function chooseStartN(settings: Settings, rng: Rng): number {
	return settings.length === 'random' ? LENGTH_MIN + rng(LENGTH_MAX - LENGTH_MIN + 1) : settings.length;
}

function freshBoard(n: number): Board {
	return { stage: 1, n, rows: [], marks: [], hints: {}, hintUsed: false, deadline: null, cleared: 0 };
}

/** 현재 방에 있는 모두가 참가자다. 끊긴 채 남은 사람도 자리를 지키며 포함된다. */
export function startGame(s: RoomState, start: { n: number; answer: Answer }, now: number): void {
	const players: Record<Pid, CompPlayer> = {};
	for (const p of s.players) {
		p.inGame = true;
		players[p.pid] = { board: freshBoard(start.n), status: 'playing', finishedAt: null, triesUsed: 0 };
	}
	s.game = {
		kind: 'comp',
		settings: { ...s.settings },
		startN: start.n,
		answers: { [start.n]: start.answer },
		startedAt: now,
		endedAt: null,
		players,
		finishOrder: [],
		graceEnd: null,
		standings: null
	};
	s.phase = 'playing';
}

function compGame(s: RoomState): CompGame | null {
	return s.phase === 'playing' && s.game?.kind === 'comp' ? s.game : null;
}

/** 진행 중인 본인 보드. 게임이 아니거나 이미 끝났으면 실패 사유. */
function activePlayer(s: RoomState, pid: Pid): Result<{ game: CompGame; me: CompPlayer }> {
	const game = compGame(s);
	if (!game) return fail('phase', '진행 중인 게임이 없습니다');
	const me = game.players[pid];
	if (!me) return fail('forbidden', '이번 게임 참가자가 아닙니다');
	if (me.status !== 'playing') return fail('phase', '이미 끝났습니다');
	return { ok: true, game, me };
}

export function isOver(game: CompGame): boolean {
	return Object.values(game.players).every((p) => p.status !== 'playing');
}

/** 전원이 끝났으면 순위를 고정하고 result로 넘어간다. 아직이면 아무 일도 하지 않는다. */
export function settle(s: RoomState, now: number): boolean {
	const game = compGame(s);
	if (!game || !isOver(game)) return false;
	game.standings = standings(game, (pid) => findPlayer(s, pid)?.name ?? '');
	game.endedAt = now;
	s.phase = 'result';
	for (const p of s.players) p.ready = false;
	// 순위표는 이미 이름을 들고 있으므로 나간 사람의 자리는 더 둘 이유가 없다.
	s.players = s.players.filter((p) => !p.left);
	return true;
}

function finish(game: CompGame, pid: Pid, status: Exclude<CompPlayer['status'], 'playing'>, now: number): void {
	const me = game.players[pid];
	me.status = status;
	me.finishedAt = now;
	me.triesUsed = me.board.rows.length;
}

/** `valid`는 DO 셸이 D1에서 읽은 사전 여부. 조회에 실패했으면 undefined. */
export function applyGuess(s: RoomState, pid: Pid, jamo: string, valid: boolean | undefined, now: number): Result<{ marks: Mark[] }> {
	const a = activePlayer(s, pid);
	if (!a.ok) return a;
	const { game, me } = a;
	const board = me.board;
	if ([...jamo].length !== board.n || ![...jamo].every(isJamo)) return fail('invalid', '자모가 부족합니다');
	if (valid === undefined) return fail('unavailable', '서버에 연결할 수 없습니다');
	if (!valid) return fail('invalid', '사전에 없는 단어입니다');
	if (game.settings.hard) {
		const v = hardViolation(board.rows, board.marks, jamo);
		if (v) return fail('hard', v.kind === 'pos' ? `${v.pos + 1}번째 칸은 ${v.jamo}입니다` : `${v.jamo}을(를) 포함해야 합니다`);
	}

	const marks = judge(game.answers[board.n].jamo, jamo);
	board.rows.push(jamo);
	board.marks.push(marks);
	if (marks.every((m) => m === 'c')) {
		board.cleared = 1;
		finish(game, pid, 'solved', now);
		game.finishOrder.push(pid);
	} else if (board.rows.length >= game.settings.tries) {
		finish(game, pid, 'failed', now);
	} else {
		me.triesUsed = board.rows.length;
	}
	settle(s, now);
	return { ok: true, marks };
}

/**
 * 개인 플레이와 같은 규칙: 노랑을 받은 자모 중 첫 번째(행·칸 순으로 처음 나온 자모)의 정답 안 첫 위치.
 * 같은 자모가 나중에 초록을 받았으면 노랑 후보가 아니다.
 */
export function useHint(s: RoomState, pid: Pid): Result<{ pos: number; jamo: string }> {
	const a = activePlayer(s, pid);
	if (!a.ok) return a;
	const { game, me } = a;
	const board = me.board;
	if (!game.settings.hints) return fail('forbidden', '힌트를 쓸 수 없는 방입니다');
	if (board.hintUsed) return fail('forbidden', '힌트는 한 판에 한 번입니다');

	const rank: Record<Mark, number> = { a: 1, p: 2, c: 3 };
	const best = new Map<string, Mark>();
	board.rows.forEach((row, r) => {
		[...row].forEach((jamo, i) => {
			const m = board.marks[r][i];
			const cur = best.get(jamo);
			if (!cur || rank[m] > rank[cur]) best.set(jamo, m);
		});
	});
	const jamo = [...best].find(([, m]) => m === 'p')?.[0];
	if (!jamo) return fail('forbidden', '힌트를 줄 노란 자모가 없습니다');

	const pos = game.answers[board.n].jamo.indexOf(jamo);
	board.hints[pos] = jamo;
	board.hintUsed = true;
	return { ok: true, pos, jamo };
}

export function giveUp(s: RoomState, pid: Pid, now: number): Result {
	const a = activePlayer(s, pid);
	if (!a.ok) return a;
	finish(a.game, pid, 'gaveup', now);
	settle(s, now);
	return { ok: true };
}

/** 방장이 끊긴 사람을 탈락시킨다. 접속 중인 사람은 대상이 아니다. */
export function eliminate(s: RoomState, hostPid: Pid, targetPid: Pid, now: number): Result {
	if (s.hostPid !== hostPid) return fail('forbidden', '방장만 탈락시킬 수 있습니다');
	const target = findPlayer(s, targetPid);
	if (!target) return fail('forbidden', '방에 없는 사람입니다');
	if (target.connected) return fail('forbidden', '접속 중인 사람은 탈락시킬 수 없습니다');
	const a = activePlayer(s, targetPid);
	if (!a.ok) return a;
	finish(a.game, targetPid, 'eliminated', now);
	settle(s, now);
	return { ok: true };
}

/** 나간 사람의 본인 탈락. 이미 끝났거나 참가자가 아니면 아무 일도 없다. */
export function forfeit(s: RoomState, pid: Pid, now: number): void {
	const game = compGame(s);
	if (!game || game.players[pid]?.status !== 'playing') return;
	finish(game, pid, 'eliminated', now);
	settle(s, now);
}
