// 개인화 스냅샷. 상태에서 필요한 필드만 골라 새 객체를 만든다(상태를 복사한 뒤 지우는 방식이 아니다).
// 새 필드는 여기서 명시적으로 추가하지 않는 한 클라이언트에 나가지 않는다.
import type { CompGameView, CoopGameView, CoopStepView, HostView, OwnBoardView, PanelView, Pid, PlayerView, Snapshot } from '../../mp/protocol.ts';
import { canStart } from './members.ts';
import { standings } from './rank.ts';
import type { CompGame, CompPlayer, CoopGame, RoomState } from './state.ts';

const panelOf = (p: CompPlayer): PanelView => ({
	stage: p.board.stage,
	n: p.board.n,
	marks: p.board.marks,
	status: p.status,
	cleared: p.board.cleared
});

const ownBoardOf = (p: CompPlayer): OwnBoardView => ({
	...panelOf(p),
	rows: p.board.rows,
	hints: p.board.hints,
	hintUsed: p.board.hintUsed,
	deadline: p.board.deadline,
	triesUsed: p.triesUsed,
	finishedAt: p.finishedAt,
	// 이전 저장본에는 필드가 없다.
	lastClear: p.lastClear ?? null
});

/** 도달한 스테이지(길이)까지의 정답만. 시작 때 미리 읽어 둔 위쪽 스테이지는 아무도 풀지 않았으면 내보내지 않는다. */
const reachedAnswers = (answers: CompGame['answers'], top: number): CompGame['answers'] =>
	Object.fromEntries(Object.entries(answers).filter(([n]) => Number(n) <= top));

function compView(s: RoomState, game: CompGame, pid: Pid): CompGameView {
	const mine = game.players[pid];
	const result = s.phase === 'result';
	const nameOf = (p: Pid) => s.players.find((q) => q.pid === p)?.name ?? '';
	const view: CompGameView = {
		kind: 'comp',
		startN: game.startN,
		startedAt: game.startedAt,
		endedAt: game.endedAt,
		graceEnd: game.graceEnd,
		me: mine ? ownBoardOf(mine) : null,
		standings: result ? game.standings : mine && mine.status !== 'playing' ? standings(game, nameOf) : null
	};
	if (result) view.answers = reachedAnswers(game.answers, Math.max(...Object.values(game.players).map((p) => p.board.n)));
	return view;
}

/** 득표수는 실시간으로 보이지만 누가 어느 후보를 찍었는지는 본인 표만 보낸다. */
function stepView(step: CoopGame['step'], pid: Pid): CoopStepView {
	if (step.kind === 'propose') return { kind: 'propose', proposals: { ...step.proposals }, drafts: { ...step.drafts } };
	const tally = step.candidates.map(() => 0);
	for (const c of Object.values(step.votes)) tally[c]++;
	return {
		kind: 'vote',
		candidates: step.candidates.map((c) => ({ jamo: c.jamo, by: [...c.by] })),
		tally,
		voted: Object.keys(step.votes),
		myVote: step.votes[pid] ?? null
	};
}

function coopView(s: RoomState, game: CoopGame, pid: Pid): CoopGameView {
	const b = game.board;
	const view: CoopGameView = {
		kind: 'coop',
		startN: game.startN,
		startedAt: game.startedAt,
		endedAt: game.endedAt,
		cleared: b.cleared,
		lastClear: game.lastClear ?? null,
		board: { stage: b.stage, n: b.n, rows: b.rows, marks: b.marks, hints: b.hints, hintUsed: b.hintUsed, hintBy: game.hintBy, deadline: b.deadline },
		status: game.status,
		step: game.status === 'playing' ? stepView(game.step, pid) : null,
		lastPick: game.lastPick
	};
	if (game.endReason) view.endReason = game.endReason;
	if (s.phase === 'result') view.answers = reachedAnswers(game.answers, b.n);
	return view;
}

export function personalize(s: RoomState, pid: Pid, now: number): Snapshot {
	const game = s.game?.kind === 'comp' ? s.game : null;
	const players: PlayerView[] = s.players.map((p) => {
		const cp = game?.players[p.pid];
		return {
			pid: p.pid,
			name: p.name,
			connected: p.connected,
			ready: p.ready,
			isHost: p.pid === s.hostPid,
			inGame: p.inGame,
			...(p.left ? { left: true as const } : {}),
			panel: cp ? panelOf(cp) : null
		};
	});

	let host: HostView | null = null;
	if (pid === s.hostPid) {
		const c = canStart(s);
		host = { canStart: c.ok, waiting: c.waiting, reason: c.reason, disconnected: c.disconnected };
	}

	return {
		v: 1,
		seq: s.seq,
		now,
		code: s.code,
		phase: s.phase,
		settings: s.settings,
		you: pid,
		hostPid: s.hostPid,
		players,
		host,
		game: game ? compView(s, game, pid) : s.game?.kind === 'coop' ? coopView(s, s.game, pid) : null
	};
}
