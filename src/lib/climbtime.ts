// 솔로 등반의 소요 시간 계산. 상태·저장은 game.svelte.ts가 맡고, 여기는 부작용 없는 함수만 둔다.

/** localStorage climbtime:<configKey>. stages는 스테이지 번호별 최단 클리어 시간(ms). */
export interface ClimbTimeRecord {
	best: { stage: number; ms: number } | null;
	stages: Record<number, number>;
}

export const emptyClimbTime = (): ClimbTimeRecord => ({ best: null, stages: {} });

/** 0:42 / 1:05:09. 시간을 모르면(옛 저장본) '-'. 초 미만은 버린다. */
export function formatTime(ms: number | null): string {
	if (ms === null) return '-';
	const s = Math.floor(Math.max(0, ms) / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 스크린리더용: 0분 42초 / 1시간 5분 9초. */
export function spokenTime(ms: number | null): string {
	if (ms === null) return '기록 없음';
	const s = Math.floor(Math.max(0, ms) / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return [h > 0 ? `${h}시간` : '', h > 0 || m > 0 ? `${m}분` : '', `${s % 60}초`].filter(Boolean).join(' ');
}

/** 클리어한 스테이지 시간의 합. 하나라도 모르면 null. */
export function totalOf(times: readonly (number | null | undefined)[]): number | null {
	let sum = 0;
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		if (t === null || t === undefined) return null;
		sum += t;
	}
	return sum;
}

type Best = { stage: number; ms: number };

/** 스테이지가 높을수록 좋고, 같으면 총 시간이 짧을수록 좋다. */
export function isBetterBest(cur: Best | null, cand: Best): boolean {
	if (!cur) return true;
	return cand.stage > cur.stage || (cand.stage === cur.stage && cand.ms < cur.ms);
}

export interface ClearInput {
	stage: number;
	/** 이 스테이지 시간. 모르면 null. */
	ms: number | null;
	/** 이번 기록의 총 시간(이 스테이지 포함). 앞 스테이지 시간을 모르면 null. */
	totalMs: number | null;
	/** 시간 기록이 생기기 전부터 있던 best:<configKey> 최고 스테이지. 시간을 모르는 기록이라 같은 스테이지부터 시간으로 갱신한다. */
	legacyBestStage: number;
}

export interface ClearResult {
	rec: ClimbTimeRecord;
	/** 이 스테이지의 이전 기록보다 빨랐다. 이전 기록이 없으면 false. */
	stageBest: boolean;
	/** 최고 기록(스테이지, 총 시간)을 새로 썼다. */
	bestBeaten: boolean;
}

export function applyClear(rec: ClimbTimeRecord, { stage, ms, totalMs, legacyBestStage }: ClearInput): ClearResult {
	let stages = rec.stages;
	let stageBest = false;
	if (ms !== null) {
		const prev = rec.stages[stage];
		stageBest = prev !== undefined && ms < prev;
		if (prev === undefined || ms < prev) stages = { ...stages, [stage]: ms };
	}

	let best = rec.best;
	let bestBeaten = false;
	if (totalMs !== null) {
		const floor: Best | null =
			rec.best && rec.best.stage >= legacyBestStage
				? rec.best
				: legacyBestStage > 0
					? { stage: legacyBestStage, ms: Infinity }
					: rec.best;
		if (isBetterBest(floor, { stage, ms: totalMs })) {
			best = { stage, ms: totalMs };
			bestBeaten = true;
		}
	}
	return { rec: { best, stages }, stageBest, bestBeaten };
}
