// 서버 전용 상태. 정답과 uid가 들어 있으므로 스냅샷 가공(snapshot.ts)을 거치지 않고 클라이언트로 보내지 않는다.
import type { Mark } from '../../types.ts';
import type { CompStatus, CoopHintVoteEnd, ErrorCode, Pid, Phase, Settings, Standing, StageClearView } from '../../mp/protocol.ts';

export type { Pid, Phase, CompStatus };

/** [0, max) 정수를 돌려준다. 테스트는 시드 고정 함수를 넣는다. */
export type Rng = (max: number) => number;

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode; msg: string };

export const fail = (code: ErrorCode, msg: string): { ok: false; code: ErrorCode; msg: string } => ({ ok: false, code, msg });

export interface Player {
	pid: Pid;
	/** 토큰의 uid. 스냅샷에 넣지 않는다. */
	uid: string;
	name: string;
	joinedAt: number;
	connected: boolean;
	disconnectedAt: number | null;
	/** 방장은 의미 없음. */
	ready: boolean;
	nudgedAt: number | null;
	inGame: boolean;
	/** 게임 중 명시적으로 나가 자리만 남은 사람. 게임이 끝나면 자리를 치운다. */
	left?: boolean;
}

export interface Answer {
	word: string;
	jamo: string;
}

export interface Board {
	stage: number;
	n: number;
	rows: string[];
	marks: Mark[][];
	hints: Record<number, string>;
	hintUsed: boolean;
	deadline: number | null;
	cleared: number;
}

interface GameBase {
	settings: Settings;
	startN: number;
	answers: Record<number, Answer>;
	startedAt: number;
	endedAt: number | null;
}

export type CoopStep =
	/** passes는 패스한 사람(값은 항상 true). 패스를 쓰기 전의 저장본에는 없다. */
	| { kind: 'propose'; proposals: Record<Pid, string>; drafts: Record<Pid, string>; passes?: Record<Pid, true> }
	| { kind: 'vote'; candidates: { jamo: string; by: Pid[] }[]; votes: Record<Pid, number> };

/** 협동 힌트 투표. yes에는 요청한 사람이 처음부터 들어 있다. 득표 집계는 접속 중인 참가자만 센다. */
export interface HintVote {
	by: Pid;
	yes: Pid[];
	no: Pid[];
	deadline: number;
}

/** 협동 힌트 투표. yes에는 요청한 사람이 처음부터 들어 있다. 득표 집계는 접속 중인 참가자만 센다. */
export interface HintVote {
	by: Pid;
	yes: Pid[];
	no: Pid[];
	deadline: number;
}

export interface CoopGame extends GameBase {
	kind: 'coop';
	board: Board;
	step: CoopStep;
	lastPick: { candidates: string[]; by: Pid[][]; chosen: number; how: 'single' | 'vote' | 'roulette'; tally?: number[]; at: number } | null;
	/** 공유 힌트를 쓴 사람. 쓰기 전에는 null. */
	hintBy: Pid | null;
	/** 열려 있는 힌트 투표. 이전 저장본에는 없을 수 있다. */
	hintVote?: HintVote | null;
	/** 가장 최근에 끝난 힌트 투표. 부결 직후 재요청 대기(HINT_VOTE_COOLDOWN_MS)의 기준이기도 하다. */
	lastHintVote?: CoopHintVoteEnd | null;
	/** 전원 패스로 제안을 다시 받기 시작한 시각. */
	passResetAt?: number | null;
	/** 등반에서 방금 클리어한 스테이지. 이전 저장본에는 없을 수 있다. */
	lastClear?: StageClearView | null;
	status: 'playing' | 'won' | 'lost';
	endReason?: 'solved' | 'tries' | 'timeout' | 'giveup';
}

export interface CompPlayer {
	board: Board;
	status: CompStatus;
	finishedAt: number | null;
	triesUsed: number;
	/** 등반에서 방금 클리어한 스테이지. 이전 저장본에는 없을 수 있다. */
	lastClear?: StageClearView | null;
}

export interface CompGame extends GameBase {
	kind: 'comp';
	players: Record<Pid, CompPlayer>;
	finishOrder: Pid[];
	graceEnd: number | null;
	standings: Standing[] | null;
}

export interface RoomState {
	v: 1;
	code: string;
	createdAt: number;
	settings: Settings;
	phase: Phase;
	hostPid: Pid | null;
	players: Player[];
	/** 접속자가 0이 된 시각. 접속자가 있으면 null. */
	emptySince: number | null;
	game: CoopGame | CompGame | null;
	seq: number;
}

const PID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 'p' 접두어: pid가 정수꼴 문자열이면 Record 키 순서가 입력 순서와 달라진다. */
export function newPid(rng: Rng, taken: Iterable<Pid> = []): Pid {
	const used = new Set(taken);
	for (;;) {
		let pid = 'p';
		for (let i = 0; i < 7; i++) pid += PID_CHARS[rng(PID_CHARS.length)];
		if (!used.has(pid)) return pid;
	}
}

/**
 * 방 생성 직후 상태. 생성자는 접속 전이지만 방장 자리를 예약한다.
 * 접속 전 생성자는 끊긴 사람과 같이 취급해(disconnectedAt = 생성 시각) 5초 안에 오지 않으면 승계 대상이 된다.
 */
export function initRoom(code: string, creator: { uid: string; name: string }, settings: Settings, now: number, rng: Rng): RoomState {
	const pid = newPid(rng);
	return {
		v: 1,
		code,
		createdAt: now,
		settings,
		phase: 'lobby',
		hostPid: pid,
		players: [{ pid, uid: creator.uid, name: creator.name, joinedAt: now, connected: false, disconnectedAt: now, ready: false, nudgedAt: null, inGame: false }],
		emptySince: now,
		game: null,
		seq: 0
	};
}
