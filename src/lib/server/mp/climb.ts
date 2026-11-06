// 등반 공통. 스테이지는 길이 n에서 시작해 n+1씩 올라 12자(LENGTH_MAX)에서 끝난다(개인 등반 nextStage와 같은 규칙).
import { CLIMB_MIN_LIMIT_MS, CLIMB_STEP_MS, LENGTH_MAX, TIME_LIMIT_MS } from '../../mp/rules.ts';
import type { Settings, StageClearView } from '../../mp/protocol.ts';
import type { Answer, Board } from './state.ts';

export const isClimb = (settings: Settings): boolean => settings.game === 'climb';

/** 마지막 스테이지(12자)인가. 여기서 정답을 맞히면 완주다. */
export const isTop = (board: Board): boolean => board.n >= LENGTH_MAX;

/** 시작 길이부터 12자까지. DO 셸이 시작 때 이 길이마다 정답을 한꺼번에 읽는다. */
export const stageLengths = (startN: number): number[] => Array.from({ length: LENGTH_MAX - startN + 1 }, (_, i) => startN + i);

/** 시작 때 DO 셸이 넘기는 값. 등반이면 `stages`가 시작 길이 위쪽의 정답을 든다. */
export interface Start {
	n: number;
	answer: Answer;
	stages?: Record<number, Answer>;
}

/** 등반인데 위쪽 스테이지 정답이 빠졌으면 진행 중에 정답을 못 찾으므로 시작 자체를 막는다. */
export const hasAllStages = (start: Start): boolean => stageLengths(start.n).every((n) => n === start.n || start.stages?.[n] !== undefined);

export const startAnswers = (start: Start): Record<number, Answer> => ({ ...start.stages, [start.n]: start.answer });

/** 등반 스테이지 k(1부터)의 제한 시간. 하한에 닿으면 그 뒤로 유지한다. */
export const stageLimitMs = (stage: number): number => Math.max(CLIMB_MIN_LIMIT_MS, TIME_LIMIT_MS - CLIMB_STEP_MS * (stage - 1));

/** 제한 시간을 끈 방은 null. `from`은 그 판·스테이지의 시간이 세기 시작하는 시각. */
export function stageDeadline(settings: Settings, stage: number, from: number): number | null {
	if (!settings.timer) return null;
	return from + (isClimb(settings) ? stageLimitMs(stage) : TIME_LIMIT_MS);
}

/**
 * 클리어한 보드에서 다음 스테이지 보드를 만든다. 호출자가 먼저 `cleared`를 올린다.
 * 힌트는 등반 전체에서 한 번이라 '썼음'만 이어받고 점선은 비운다. 시도 횟수는 설정값 그대로 새로 센다.
 * `deadline`은 다음 스테이지의 마감(stageDeadline). 제한 시간이 꺼져 있으면 null.
 */
export function climbUp(board: Board, now: number, deadline: number | null = null): { next: Board; clear: StageClearView } {
	return {
		next: { stage: board.stage + 1, n: board.n + 1, rows: [], marks: [], hints: {}, hintUsed: board.hintUsed, deadline, cleared: board.cleared },
		clear: { stage: board.stage, n: board.n, rows: board.rows, marks: board.marks, at: now }
	};
}

export const hintUsedMsg = (settings: Settings): string => (isClimb(settings) ? '힌트는 등반 전체에서 한 번입니다' : '힌트는 한 판에 한 번입니다');
