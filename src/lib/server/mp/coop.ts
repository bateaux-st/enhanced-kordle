// 협동 단판. 방 전원이 공유 보드 하나를 푼다. 한 행은 제안 -> (투표) -> 판정 순이다.
// 집계 대상은 접속 중이고 나가지 않은 참가자다. 끊긴 사람은 기다리지도, 탈락시키지도 않는다.
import { isJamo } from '../../jamo.ts';
import { judge } from '../judge.ts';
import type { Pid } from '../../mp/protocol.ts';
import { climbUp, hintUsedMsg, isClimb, isTop, startAnswers } from './climb.ts';
import type { Start } from './climb.ts';
import { checkGuess, freshBoard, hintFor } from './comp.ts';
import { findPlayer } from './members.ts';
import { fail } from './state.ts';
import type { CoopGame, CoopStep, Player, Result, Rng, RoomState } from './state.ts';

type ProposeStep = Extract<CoopStep, { kind: 'propose' }>;
type VoteStep = Extract<CoopStep, { kind: 'vote' }>;
type Pick = NonNullable<CoopGame['lastPick']>;

const emptyPropose = (): ProposeStep => ({ kind: 'propose', proposals: {}, drafts: {} });

const noGame = () => fail('phase', '진행 중인 협동 게임이 없습니다');

export function startGame(s: RoomState, start: Start, now: number): void {
	for (const p of s.players) p.inGame = true;
	s.game = {
		kind: 'coop',
		settings: { ...s.settings },
		startN: start.n,
		answers: startAnswers(start),
		startedAt: now,
		endedAt: null,
		board: freshBoard(start.n),
		step: emptyPropose(),
		lastPick: null,
		hintBy: null,
		lastClear: null,
		status: 'playing'
	};
	s.phase = 'playing';
}

function coopGame(s: RoomState): CoopGame | null {
	return s.phase === 'playing' && s.game?.kind === 'coop' && s.game.status === 'playing' ? s.game : null;
}

/** 이번 게임 참가자이고 나가지 않았다. */
export function seated(s: RoomState, pid: Pid): boolean {
	const p = findPlayer(s, pid);
	return p !== undefined && p.inGame && !p.left;
}

/** 집계 대상. 끊긴 사람은 빠진다. */
const countable = (s: RoomState): Player[] => s.players.filter((p) => p.inGame && !p.left && p.connected);

/** 이 사람이 찍을 수 있는 후보가 하나라도 있는지. 자기 제안이 들어간 후보는 못 찍는다. */
const hasVotable = (step: VoteStep, pid: Pid): boolean => step.candidates.some((c) => !c.by.includes(pid));

/** 같은 자모열은 후보 하나로 합친다. 순서는 처음 제안한 순. */
function mergeProposals(proposals: Record<Pid, string>): VoteStep['candidates'] {
	const out: VoteStep['candidates'] = [];
	for (const [pid, jamo] of Object.entries(proposals)) {
		const c = out.find((x) => x.jamo === jamo);
		if (c) c.by.push(pid);
		else out.push({ jamo, by: [pid] });
	}
	return out;
}

function endGame(s: RoomState, game: CoopGame, status: 'won' | 'lost', reason: NonNullable<CoopGame['endReason']>, now: number): void {
	game.status = status;
	game.endReason = reason;
	game.step = emptyPropose();
	game.endedAt = now;
	s.phase = 'result';
	for (const p of s.players) p.ready = false;
	s.players = s.players.filter((p) => !p.left);
}

/** 고른 후보를 공유 보드에 넣고 판정한다. 제안·초안·투표는 모두 비우고 다음 행 제안으로 돌아간다. */
function submit(s: RoomState, game: CoopGame, cands: VoteStep['candidates'], chosen: number, how: Pick['how'], tally: number[] | undefined, now: number): void {
	const board = game.board;
	const candidates = cands.map((c) => c.jamo);
	const jamo = candidates[chosen];
	const marks = judge(game.answers[board.n].jamo, jamo);
	board.rows.push(jamo);
	board.marks.push(marks);
	// by는 클라이언트가 돌림판 후보 옆에 제안자 이름을 그리는 데 쓴다. 투표 단계가 아닌 즉시 제출도 같은 모양이다.
	game.lastPick = { candidates, by: cands.map((c) => [...c.by]), chosen, how, ...(tally ? { tally } : {}), at: now };
	game.step = emptyPropose();
	if (marks.every((m) => m === 'c')) {
		board.cleared += 1;
		if (isClimb(game.settings) && !isTop(board)) {
			const up = climbUp(board, now);
			game.board = up.next;
			game.lastClear = up.clear;
		} else endGame(s, game, 'won', 'solved', now);
	} else if (board.rows.length >= game.settings.tries) endGame(s, game, 'lost', 'tries', now);
}

/** 제안을 닫는다. 후보가 하나면 바로 제출, 돌림판 방식이면 서버가 즉시 고르고, 투표 방식이면 투표 단계로 간다. */
function closePropose(s: RoomState, game: CoopGame, step: ProposeStep, rng: Rng, now: number): void {
	const candidates = mergeProposals(step.proposals);
	if (candidates.length === 1) submit(s, game, candidates, 0, 'single', undefined, now);
	else if (game.settings.pick === 'roulette') submit(s, game, candidates, rng(candidates.length), 'roulette', undefined, now);
	else game.step = { kind: 'vote', candidates, votes: {} };
}

/** 투표를 집계한다. 최다 득표가 하나면 그 후보, 동률(0표 동률 포함)이면 동률 후보끼리 서버가 돌림판으로 정한다. */
function closeVote(s: RoomState, game: CoopGame, step: VoteStep, rng: Rng, now: number): void {
	const tally = step.candidates.map(() => 0);
	for (const c of Object.values(step.votes)) tally[c]++;
	const top = Math.max(...tally);
	const tied = tally.flatMap((t, i) => (t === top ? [i] : []));
	if (tied.length === 1) submit(s, game, step.candidates, tied[0], 'vote', tally, now);
	else submit(s, game, step.candidates, tied[rng(tied.length)], 'roulette', tally, now);
}

/**
 * 집계 조건을 다시 본다. 메시지뿐 아니라 접속 끊김·나가기·재접속으로도 조건이 채워질 수 있어
 * 상태를 바꾸는 모든 경로가 이 함수를 지난다. 집계 대상이 없으면(아무도 접속하지 않음) 멈춰 기다린다.
 * 같은 상태에서 다시 불러도 결과가 같다. 바뀐 것이 있으면 true.
 */
export function advance(s: RoomState, rng: Rng, now: number): boolean {
	let moved = false;
	for (;;) {
		const game = coopGame(s);
		const who = countable(s);
		if (!game || who.length === 0) return moved;
		const step = game.step;
		if (step.kind === 'propose') {
			if (!who.every((p) => p.pid in step.proposals)) return moved;
			closePropose(s, game, step, rng, now);
		} else {
			// 찍을 후보가 없는 사람은 기다리지 않는다. 대상이 0명이면 바로 집계한다.
			if (!who.filter((p) => hasVotable(step, p.pid)).every((p) => p.pid in step.votes)) return moved;
			closeVote(s, game, step, rng, now);
		}
		moved = true;
	}
}

type Member = Result<{ game: CoopGame }>;

function member(s: RoomState, pid: Pid): Member {
	const game = coopGame(s);
	if (!game) return noGame();
	if (!seated(s, pid)) return fail('forbidden', '이번 게임 참가자가 아닙니다');
	return { ok: true, game };
}

/** 입력 중인 글자. 저장하지 않고 전원에게 보여 주기만 하므로 D1을 읽지 않고, 확정 제안은 건드리지 않는다. */
export function draft(s: RoomState, pid: Pid, jamo: string): Result<{ changed: boolean }> {
	const m = member(s, pid);
	if (!m.ok) return m;
	const { step, board } = m.game;
	if (step.kind !== 'propose') return fail('phase', '제안 단계가 아닙니다');
	if ([...jamo].length > board.n || ![...jamo].every(isJamo)) return fail('invalid', '자모 수가 맞지 않습니다');
	if ((step.drafts[pid] ?? '') === jamo) return { ok: true, changed: false };
	if (jamo === '') delete step.drafts[pid];
	else step.drafts[pid] = jamo;
	return { ok: true, changed: true };
}

/** 제안 확정. 마감 전에는 다시 보내 덮어쓸 수 있고 철회는 없다. `valid`는 DO 셸이 D1에서 읽은 사전 여부. */
export function propose(s: RoomState, pid: Pid, jamo: string, valid: boolean | undefined, rng: Rng, now: number): Result<{ changed: boolean }> {
	const m = member(s, pid);
	if (!m.ok) return m;
	const { game } = m;
	const step = game.step;
	if (step.kind !== 'propose') return fail('phase', '제안 단계가 아닙니다');
	const bad = checkGuess(game.board, jamo, valid, game.settings.hard);
	if (bad) return bad;

	let changed = step.proposals[pid] !== jamo || step.drafts[pid] !== jamo;
	step.proposals[pid] = jamo;
	step.drafts[pid] = jamo;
	changed = advance(s, rng, now) || changed;
	return { ok: true, changed };
}

/** 방장의 마감. 제안 단계는 제안이 하나 이상일 때만, 투표 단계는 지금까지의 표로 집계한다. */
export function close(s: RoomState, pid: Pid, rng: Rng, now: number): Result {
	const game = coopGame(s);
	if (!game) return noGame();
	if (s.hostPid !== pid) return fail('forbidden', '방장만 마감할 수 있습니다');
	const step = game.step;
	if (step.kind === 'propose') {
		if (Object.keys(step.proposals).length === 0) return fail('forbidden', '제안이 하나도 없습니다');
		closePropose(s, game, step, rng, now);
	} else closeVote(s, game, step, rng, now);
	// 투표 방식으로 막 넘어갔는데 찍을 사람이 없을 수 있다.
	advance(s, rng, now);
	return { ok: true };
}

/** 1인 1표. 집계 전까지는 다른 후보로 바꿀 수 있고, 자기 제안이 들어간 후보에는 못 찍는다. */
export function vote(s: RoomState, pid: Pid, candidate: number, rng: Rng, now: number): Result<{ changed: boolean }> {
	const m = member(s, pid);
	if (!m.ok) return m;
	const { game } = m;
	const step = game.step;
	if (step.kind !== 'vote') return fail('phase', '투표 단계가 아닙니다');
	const target = step.candidates[candidate];
	if (!target) return fail('invalid', '없는 후보입니다');
	if (target.by.includes(pid)) return fail('forbidden', '자기 제안에는 투표할 수 없습니다');

	let changed = step.votes[pid] !== candidate;
	step.votes[pid] = candidate;
	changed = advance(s, rng, now) || changed;
	return { ok: true, changed };
}

/** 판당 1회(등반은 등반 전체에서 1회), 참가자 누구나. 계산은 경쟁 힌트와 같고 쓴 사람을 남긴다. */
export function useHint(s: RoomState, pid: Pid): Result<{ pos: number; jamo: string }> {
	const m = member(s, pid);
	if (!m.ok) return m;
	const { game } = m;
	const board = game.board;
	if (!game.settings.hints) return fail('forbidden', '힌트를 쓸 수 없는 방입니다');
	if (board.hintUsed) return fail('forbidden', hintUsedMsg(game.settings));
	const h = hintFor(board, game.answers[board.n].jamo);
	if (!h.ok) return h;
	board.hints[h.pos] = h.jamo;
	board.hintUsed = true;
	game.hintBy = pid;
	return h;
}

/** 방장이 공유 판 전체를 실패로 끝낸다. */
export function giveUp(s: RoomState, pid: Pid, now: number): Result {
	const game = coopGame(s);
	if (!game) return noGame();
	if (s.hostPid !== pid) return fail('forbidden', '방장만 포기할 수 있습니다');
	endGame(s, game, 'lost', 'giveup', now);
	return { ok: true };
}

/**
 * 나간 사람의 제안·초안·투표를 지운다. 투표 중이면 후보에서도 빠지고, 제안자가 없어진 후보는 사라진다.
 * 후보가 하나만 남으면 선택 없이 제출하고, 없으면 제안 단계로 돌아간다.
 */
export function forfeit(s: RoomState, pid: Pid, rng: Rng, now: number): void {
	const game = coopGame(s);
	if (!game) return;
	const step = game.step;
	if (step.kind === 'propose') {
		delete step.proposals[pid];
		delete step.drafts[pid];
	} else {
		delete step.votes[pid];
		const kept: number[] = [];
		const candidates = step.candidates.flatMap((c, i) => {
			const by = c.by.filter((x) => x !== pid);
			if (by.length === 0) return [];
			kept.push(i);
			return [{ jamo: c.jamo, by }];
		});
		// 사라진 후보에 던진 표는 버리고, 남은 후보의 번호가 당겨진 만큼 표의 번호도 맞춘다.
		const votes: Record<Pid, number> = {};
		for (const [voter, idx] of Object.entries(step.votes)) if (kept.includes(idx)) votes[voter] = kept.indexOf(idx);
		if (candidates.length === 0) game.step = emptyPropose();
		else if (candidates.length === 1) submit(s, game, [candidates[0]], 0, 'single', undefined, now);
		else game.step = { kind: 'vote', candidates, votes };
	}
	advance(s, rng, now);
}
