// 경쟁 게임. 단판은 같은 정답을, 등반은 같은 단어 순서를 각자 개인 보드로 푼다. 제한 시간은 각자 보드의 마감으로 센다.
import { judge } from '../judge.ts';
import { hardViolation } from '../../hard.ts';
import { isJamo } from '../../jamo.ts';
import { CLIMB_GRACE_MS, DISCONNECT_GRACE_MS, LENGTH_MAX, LENGTH_MIN, STAGE_CLEAR_MS } from '../../mp/rules.ts';
import type { Mark } from '../../types.ts';
import type { Pid, Settings } from '../../mp/protocol.ts';
import { climbUp, hintUsedMsg, isClimb, isTop, stageDeadline, startAnswers } from './climb.ts';
import type { Start } from './climb.ts';
import { findPlayer } from './members.ts';
import { standings } from './rank.ts';
import { fail } from './state.ts';
import type { Board, CompGame, CompPlayer, Result, Rng, RoomState } from './state.ts';

/** 시작 길이. 'random'이면 5..12에서 하나. DO 셸이 이 값으로 D1에서 정답을 읽어 startGame에 넘긴다. */
export function chooseStartN(settings: Settings, rng: Rng): number {
	return settings.length === 'random' ? LENGTH_MIN + rng(LENGTH_MAX - LENGTH_MIN + 1) : settings.length;
}

export function freshBoard(n: number, deadline: number | null = null): Board {
	return { stage: 1, n, rows: [], marks: [], hints: {}, hintUsed: false, deadline, cleared: 0 };
}

/** 현재 방에 있는 모두가 참가자다. 끊긴 채 남은 사람도 자리를 지키며 포함된다. */
export function startGame(s: RoomState, start: Start, now: number): void {
	const players: Record<Pid, CompPlayer> = {};
	for (const p of s.players) {
		p.inGame = true;
		players[p.pid] = { board: freshBoard(start.n, stageDeadline(s.settings, 1, now)), status: 'playing', finishedAt: null, triesUsed: 0, lastClear: null };
	}
	s.game = {
		kind: 'comp',
		settings: { ...s.settings },
		startN: start.n,
		answers: startAnswers(start),
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

/**
 * 제출 전 검사(경쟁 guess와 협동 propose가 같은 문구를 쓴다). `valid`는 DO 셸이 D1에서 읽은 사전 여부이고 조회에 실패했으면 undefined.
 * 통과하면 null.
 */
export function checkGuess(board: Board, jamo: string, valid: boolean | undefined, hard: boolean): ReturnType<typeof fail> | null {
	if ([...jamo].length !== board.n || ![...jamo].every(isJamo)) return fail('invalid', '자모가 부족합니다');
	if (valid === undefined) return fail('unavailable', '서버에 연결할 수 없습니다');
	if (!valid) return fail('invalid', '사전에 없는 단어입니다');
	if (hard) {
		const v = hardViolation(board.rows, board.marks, jamo);
		if (v) return fail('hard', v.kind === 'pos' ? `${v.pos + 1}번째 칸은 ${v.jamo}입니다` : `${v.jamo}을(를) 포함해야 합니다`);
	}
	return null;
}

export function applyGuess(s: RoomState, pid: Pid, jamo: string, valid: boolean | undefined, now: number): Result<{ marks: Mark[] }> {
	const a = activePlayer(s, pid);
	if (!a.ok) return a;
	const { game, me } = a;
	const board = me.board;
	const bad = checkGuess(board, jamo, valid, game.settings.hard);
	if (bad) return bad;

	const marks = judge(game.answers[board.n].jamo, jamo);
	board.rows.push(jamo);
	board.marks.push(marks);
	if (marks.every((m) => m === 'c')) {
		board.cleared += 1;
		if (isClimb(game.settings) && !isTop(board)) {
			// 서버는 기다리지 않고 바로 다음 스테이지로 넘긴다. 클리어 연출은 lastClear로 클라이언트가 맡는다.
			const up = climbUp(board, now, stageDeadline(game.settings, board.stage + 1, now + STAGE_CLEAR_MS));
			me.board = up.next;
			me.lastClear = up.clear;
			me.triesUsed = 0;
		} else {
			finish(game, pid, 'solved', now);
			game.finishOrder.push(pid);
			// 첫 완주자만 유예를 연다. 이미 열렸으면 그 마감을 바꾸지 않는다.
			if (isClimb(game.settings) && game.graceEnd === null) game.graceEnd = now + CLIMB_GRACE_MS;
		}
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
 * 같은 자모가 나중에 초록을 받았으면 노랑 후보가 아니다. 경쟁 개인 보드와 협동 공유 보드가 함께 쓴다.
 */
export function hintFor(board: Board, answerJamo: string): Result<{ pos: number; jamo: string }> {
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
	return { ok: true, pos: answerJamo.indexOf(jamo), jamo };
}

export function useHint(s: RoomState, pid: Pid): Result<{ pos: number; jamo: string }> {
	const a = activePlayer(s, pid);
	if (!a.ok) return a;
	const { game, me } = a;
	const board = me.board;
	if (!game.settings.hints) return fail('forbidden', '힌트를 쓸 수 없는 방입니다');
	if (board.hintUsed) return fail('forbidden', hintUsedMsg(game.settings));

	const h = hintFor(board, game.answers[board.n].jamo);
	if (!h.ok) return h;
	board.hints[h.pos] = h.jamo;
	board.hintUsed = true;
	return h;
}

export function giveUp(s: RoomState, pid: Pid, now: number): Result {
	const a = activePlayer(s, pid);
	if (!a.ok) return a;
	finish(a.game, pid, 'gaveup', now);
	settle(s, now);
	return { ok: true };
}

/** 유예가 끝났다. 아직 오르는 사람은 그 시점 높이에서 멈춘다(시간 초과). 같은 now로 다시 불러도 결과가 같다. */
export function expireGrace(s: RoomState, now: number): boolean {
	const game = compGame(s);
	if (!game || game.graceEnd === null || now < game.graceEnd) return false;
	// 알람이 늦게 울려도 순위 입력이 흔들리지 않도록 마감 시각으로 기록한다.
	for (const [pid, p] of Object.entries(game.players)) if (p.status === 'playing') finish(game, pid, 'timeout', game.graceEnd);
	settle(s, now);
	return true;
}

/**
 * 마감이 지난 보드의 주인을 시간 초과로 멈춘다(등반이면 그 시점 높이 그대로). 같은 now로 다시 불러도 결과가 같다.
 * 기록 시각은 마감(유예가 먼저 끝났으면 유예 마감)이라 알람이 늦어도 순위 입력이 흔들리지 않는다.
 */
export function expireDeadlines(s: RoomState, now: number): boolean {
	const game = compGame(s);
	if (!game) return false;
	let moved = false;
	for (const [pid, p] of Object.entries(game.players)) {
		const due = p.board.deadline;
		if (p.status !== 'playing' || due === null || now < due) continue;
		finish(game, pid, 'timeout', Math.min(due, game.graceEnd ?? due));
		moved = true;
	}
	if (moved) settle(s, now);
	return moved;
}

/** 끊긴 사람의 자동 탈락 시각. 접속 중이면 null. */
export function eliminationAt(s: RoomState, pid: Pid): number | null {
	const p = findPlayer(s, pid);
	if (!p || p.connected || p.disconnectedAt === null) return null;
	return p.disconnectedAt + DISCONNECT_GRACE_MS;
}

/** 진행 중인 사람이 끊긴 지 DISCONNECT_GRACE_MS가 지나면 탈락시킨다. 이미 끝난 사람은 대상이 아니고, 돌아와도 되살리지 않는다. */
export function expireDisconnected(s: RoomState, now: number): boolean {
	const game = compGame(s);
	if (!game) return false;
	let moved = false;
	for (const [pid, p] of Object.entries(game.players)) {
		const at = p.status === 'playing' ? eliminationAt(s, pid) : null;
		if (at === null || now < at) continue;
		finish(game, pid, 'eliminated', at);
		moved = true;
	}
	if (moved) settle(s, now);
	return moved;
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
