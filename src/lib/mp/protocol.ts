// 클라이언트와 서버가 함께 쓰는 멀티플레이 계약. 타입과 리터럴 상수만 둔다.
import type { Mark } from '../types.ts';

export type Pid = string;
export type Phase = 'lobby' | 'playing' | 'result';
export type Kind = 'coop' | 'comp';
export type GameKind = 'single' | 'climb';
export type CompStatus = 'playing' | 'solved' | 'failed' | 'gaveup' | 'timeout' | 'eliminated';

export interface Settings {
	kind: Kind;
	game: GameKind;
	/** 시작 길이 5..12, 'random'이면 시작 때 정한다. */
	length: number | 'random';
	/** 4..10 */
	tries: number;
	hard: boolean;
	hints: boolean;
	timer: boolean;
	/** 협동에서만 의미가 있다. */
	pick: 'vote' | 'roulette';
}

export type ClientMsg =
	| { type: 'hello'; token?: string; name: string }
	| { type: 'ready'; on: boolean }
	| { type: 'nudge' }
	| { type: 'leave' }
	| { type: 'settings'; settings: Settings }
	| { type: 'start'; kickDisconnected?: boolean }
	| { type: 'next'; settings?: Settings }
	| { type: 'again' }
	| { type: 'draft'; jamo: string }
	| { type: 'propose'; jamo: string }
	| { type: 'close' }
	| { type: 'vote'; candidate: number }
	| { type: 'guess'; jamo: string }
	| { type: 'hint' }
	| { type: 'giveup' }
	| { type: 'eliminate'; pid: Pid };

/** 상태가 바뀌지 않는 거절. 스냅샷이 따라오지 않는다. */
export type ErrorCode = 'invalid' | 'hard' | 'forbidden' | 'phase' | 'cooldown' | 'unavailable';

export interface Standing {
	pid: Pid;
	/** 게임이 끝난 뒤에도 보이도록 순위표가 이름을 들고 있다. */
	name: string;
	rank: number;
	tied: boolean;
	/** 순위표를 만든 시점의 상태. result 뒤에 사람이 나가도 바뀌지 않도록 순위표가 직접 들고 있다. */
	status: CompStatus;
	/** 제출한 행 수. */
	tries: number;
	/** 정답자끼리의 순서(1부터). 정답자가 아니면 null. */
	finishOrder: number | null;
}

/** 남의 보드는 이 필드만 보인다. rows(자모)와 hints는 만들지 않는다. */
export interface PanelView {
	stage: number;
	n: number;
	marks: Mark[][];
	status: CompStatus;
	cleared: number;
}

export interface PlayerView {
	pid: Pid;
	name: string;
	connected: boolean;
	ready: boolean;
	isHost: boolean;
	inGame: boolean;
	panel: PanelView | null;
}

export interface OwnBoardView extends PanelView {
	rows: string[];
	hints: Record<number, string>;
	hintUsed: boolean;
	deadline: number | null;
	triesUsed: number;
	finishedAt: number | null;
}

export interface CompGameView {
	kind: 'comp';
	startN: number;
	startedAt: number;
	endedAt: number | null;
	graceEnd: number | null;
	/** 이번 게임 참가자가 아니면 null. */
	me: OwnBoardView | null;
	/** 내가 끝났거나 result일 때만. */
	standings: Standing[] | null;
	/** result에서만. 진행 중에는 누구에게도 보내지 않는다. */
	answers?: Record<number, { word: string; jamo: string }>;
}

export interface HostView {
	canStart: boolean;
	/** 준비하지 않은 접속자 수. */
	waiting: number;
	reason: 'phase' | 'no_host' | 'alone' | 'waiting' | null;
	/** 끊긴 채 자리를 지키는 사람. 시작에 `kickDisconnected`를 보내면 내보낸다. */
	disconnected: Pid[];
}

export interface Snapshot {
	v: 1;
	seq: number;
	/** 서버 시각(ms), 카운트다운 보정용. */
	now: number;
	code: string;
	phase: Phase;
	settings: Settings;
	you: Pid;
	hostPid: Pid | null;
	players: PlayerView[];
	host: HostView | null;
	game: CompGameView | null;
}

export interface SessionInfo {
	token: string;
	/** 만료 시각(ms). */
	exp: number;
}

export type ServerMsg =
	| { type: 'welcome'; pid: Pid; name: string }
	| { type: 'snap'; snap: Snapshot; session?: SessionInfo }
	| { type: 'error'; code: ErrorCode; msg: string }
	| { type: 'nudge'; from: string }
	/** `next`를 받은 방장에게만. 대기실의 설정 영역으로 이끈다. */
	| { type: 'opensettings' };

export const CLOSE = {
	/** 같은 uid의 새 소켓. */
	REPLACED: 4000,
	FULL: 4001,
	IN_PROGRESS: 4002,
	NO_ROOM: 4004,
	/** 방 소멸. 토큰 문제로는 쓰지 않는다. */
	DESTROYED: 4005
} as const;

export interface RoomSummary {
	code: string;
	/** 방장 닉네임. 방장이 없으면 빈 문자열. */
	host: string;
	kind: Kind;
	game: GameKind;
	players: number;
	max: number;
	inProgress: boolean;
	/** Lobby DO가 받은 시각(서버 시계). */
	updatedAt: number;
}

export interface CreateRoomRequest {
	token?: string;
	name: string;
	settings?: Settings;
}

export interface CreateRoomResponse {
	code: string;
	session: SessionInfo;
}
