import type {
	CheckRequest,
	CheckResponse,
	GameMode,
	GuessResponse,
	HintRequest,
	HintResponse,
	LengthMode,
	Mark,
	NewGameRequest,
	NewGameResponse,
	RevealResponse
} from './types';
import { MAX_N, MIN_N } from './jamo';
import { hardViolation } from './hard';
import { load, removeWhere, save } from './storage';
import { todayKST } from './day';

export interface ModeConfig {
	mode: GameMode;
	length: LengthMode;
}

export interface Stats {
	played: number;
	won: number;
	streak: number;
	maxStreak: number;
	/** dist[k] = k+1번째 시도에 맞힌 횟수 */
	dist: number[];
}

export type Status = 'loading' | 'playing' | 'won' | 'lost';

export const DEFAULT_TRIES = 6;
/** 데일리는 모두가 같은 조건이어야 비교가 되니 시도 횟수를 고정한다. */
export const DAILY_TRIES = 6;
export const MIN_TRIES = 4;
export const MAX_TRIES = 10;

export const lengthKey = (l: LengthMode) => (l.kind === 'fixed' ? `fixed-${l.n}` : 'random');
export const configKey = (c: ModeConfig) => `${c.mode}:${lengthKey(c.length)}`;
export const isClimb = (m: GameMode) => m === 'climb-streak' || m === 'climb-length' || m === 'daily-climb';
/** 날짜로 정답이 정해지고 하루 한 번인 모드 — 시도 횟수 고정, 진행 저장·복원. */
export const isDaily = (m: GameMode) => m === 'daily' || m === 'daily-climb';

/** 데일리 계열의 한 판 진행. 키는 daily:<날짜>:<토큰> — 토큰이 n·풀·정답을 함축한다. */
interface DailySave {
	rows: string[];
	marks: Mark[][];
	status: Status;
	answer: string | null;
	hints?: Record<number, string>;
}

/** 일일 등반의 코스 진행(어느 스테이지까지 왔나). 키는 dclimb:<날짜>. 스테이지별 판은 DailySave에 있다. */
interface DailyClimbSave {
	stage: number;
	n: number;
	climbWords: string[];
}

const emptyStats = (): Stats => ({ played: 0, won: 0, streak: 0, maxStreak: 0, dist: [] });

async function post<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`${url} ${res.status}`);
	return res.json();
}

export class Game {
	config = $state<ModeConfig>(load('config', { mode: 'daily', length: { kind: 'fixed', n: 6 } }));
	settingTries = $state<number>(load('settings', { maxTries: DEFAULT_TRIES }).maxTries);
	/** 하드모드 — 초록 자리와 노랑 자모를 다음 추측에 반드시 다시 쓴다. 기존 사용자의 저장값에는 이 키가 없다(마이그레이션 없음). */
	hard = $state<boolean>(load<{ hard?: boolean }>('settings', {}).hard ?? false);

	n = $state(6);
	token = $state('');
	rows = $state<string[]>([]);
	marks = $state<Mark[][]>([]);
	current = $state('');
	/** n자를 다 채웠는데 사전에 없는 열이면 true — 제출 전에 빨간 글자로 알려준다. */
	invalid = $state(false);
	status = $state<Status>('loading');
	answer = $state<string | null>(null);
	/** 힌트로 밝혀진 칸: 위치 → 자모. 입력 행에 흐리게 미리 보여준다. */
	hints = $state<Record<number, string>>({});
	/** 힌트는 한 판에 한 번. hints가 비어 있지 않으면 이미 쓴 것 — 데일리 복원 시에도 그대로 이어진다. */
	hintUsed = $derived(Object.keys(this.hints).length > 0);
	stage = $state(1);
	/** 이번 등반에서 클리어한 정답들 — 종료 시 피라미드로 보여준다. */
	climbWords = $state<string[]>([]);
	bestStage = $state(0);
	stats = $state<Stats>(emptyStats());
	busy = $state(false);
	toast = $state<string | null>(null);
	shake = $state(false);

	maxTries = $derived(isDaily(this.config.mode) ? DAILY_TRIES : this.settingTries);
	/** 원작처럼 판 도중에는 켤 수 없다 — 이미 낸 추측이 제약을 어겨 있을 수 있다. 끄는 건 언제나 된다. */
	canEnableHard = $derived(this.status !== 'playing' || this.rows.length === 0);

	/** 자모별로 지금까지 받은 최고 판정 — 키보드 색에 쓴다. */
	keyStates = $derived.by(() => {
		const rank: Record<Mark, number> = { a: 1, p: 2, c: 3 };
		const out: Record<string, Mark> = {};
		this.rows.forEach((row, r) => {
			[...row].forEach((j, i) => {
				const m = this.marks[r][i];
				if (!out[j] || rank[m] > rank[out[j]]) out[j] = m;
			});
		});
		return out;
	});

	private toastTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		this.loadRecords();
	}

	private loadRecords() {
		this.stats = load(`stats:${this.config.mode}`, emptyStats());
		this.bestStage = load(`best:${configKey(this.config)}`, 0);
	}

	showToast(msg: string, ms = 1500) {
		this.toast = msg;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => (this.toast = null), ms);
	}

	setConfig(c: ModeConfig) {
		this.config = c;
		save('config', c);
		this.loadRecords();
		void this.newGame();
	}

	setTries(t: number) {
		this.settingTries = Math.min(MAX_TRIES, Math.max(MIN_TRIES, t));
		this.saveSettings();
	}

	setHard(on: boolean) {
		if (on && !this.canEnableHard) return;
		this.hard = on;
		this.saveSettings();
	}

	private saveSettings() {
		save('settings', { maxTries: this.settingTries, hard: this.hard });
	}

	/** 스테이지 1부터(등반) 또는 새 단어로 시작. 일일 등반은 오늘 진행이 있으면 그 스테이지부터. */
	async newGame() {
		this.stage = 1;
		this.climbWords = [];
		if (this.config.mode === 'daily-climb') {
			// 코스는 항상 5자에서 시작해 12자까지 — 모두 같은 코스여야 데일리다.
			const saved = load<DailyClimbSave | null>(`dclimb:${todayKST()}`, null);
			if (saved) {
				this.stage = saved.stage;
				this.climbWords = saved.climbWords;
			}
			await this.begin(saved?.n ?? MIN_N);
			return;
		}
		await this.begin(this.config.length.kind === 'fixed' ? this.config.length.n : undefined);
	}

	/** 등반 모드에서 클리어 후 다음 스테이지. 길이 상승은 n+1, 연속 클리어는 같은 규칙으로 재추첨. */
	async nextStage() {
		this.stage += 1;
		if (this.config.mode === 'climb-length' || this.config.mode === 'daily-climb') await this.begin(this.n + 1);
		else await this.begin(this.config.length.kind === 'fixed' ? this.config.length.n : undefined);
		if (this.config.mode === 'daily-climb') this.saveDailyClimb();
	}

	private async begin(n?: number) {
		this.status = 'loading';
		this.rows = [];
		this.marks = [];
		this.current = '';
		this.invalid = false;
		this.answer = null;
		this.hints = {};

		const mode = this.config.mode;
		const res = await post<NewGameResponse>('/api/game', { mode, n } satisfies NewGameRequest);
		this.token = res.token;
		this.n = res.n;

		if (isDaily(mode)) {
			// 토큰이 n·풀·정답을 함축하므로 날짜와 묶어 키로 쓰면 "오늘 이 판" 진행만 정확히 복원된다.
			const saved = load<DailySave | null>(this.dailyKey(), null);
			if (saved) {
				this.rows = saved.rows;
				this.marks = saved.marks;
				this.status = saved.status;
				this.answer = saved.answer;
				this.hints = saved.hints ?? {};
				return;
			}
		}
		this.status = 'playing';
	}

	type(j: string) {
		if (this.status !== 'playing' || this.busy) return;
		if (this.current.length < this.n) {
			this.current += j;
			if (this.current.length === this.n) void this.checkCurrent();
		}
	}

	back() {
		if (this.status !== 'playing' || this.busy) return;
		this.current = this.current.slice(0, -1);
		this.invalid = false;
	}

	private async checkCurrent() {
		const jamo = this.current;
		try {
			const res = await post<CheckResponse>('/api/check', { jamo } satisfies CheckRequest);
			// 응답이 오는 사이 지우고 다시 쳤을 수 있다 — 지금 입력과 같을 때만 반영한다.
			if (this.current === jamo) this.invalid = !res.valid;
		} catch {
			/* 확인 실패는 제출 시 서버 판정이 다시 걸러준다 */
		}
	}

	/** 노란 판정을 받은 자모 하나의 실제 첫 위치를 알려준다. 한 판에 한 번. 슈퍼겁쟁이용. */
	async hint() {
		if (this.status !== 'playing' || this.busy) return;
		if (this.hintUsed) {
			this.showToast('힌트는 한 판에 한 번입니다');
			return;
		}
		const jamo = Object.entries(this.keyStates).find(([, m]) => m === 'p')?.[0];
		if (!jamo) {
			this.showToast('힌트를 줄 노란 자모가 없습니다');
			return;
		}
		this.busy = true;
		try {
			const { pos } = await post<HintResponse>('/api/hint', { token: this.token, jamo } satisfies HintRequest);
			this.hints = { ...this.hints, [pos]: jamo };
			this.showToast(`${jamo}은(는) ${pos + 1}번째 칸`, 2500);
			if (isDaily(this.config.mode)) this.saveDaily();
		} catch {
			this.showToast('서버에 연결할 수 없습니다');
		} finally {
			this.busy = false;
		}
	}

	/** 포기 — 패배로 기록하고 정답을 공개한다. */
	async giveUp() {
		if (this.status !== 'playing' || this.busy) return;
		this.busy = true;
		try {
			await this.finish(false);
		} finally {
			this.busy = false;
		}
	}

	async submit() {
		if (this.status !== 'playing' || this.busy) return;
		if (this.current.length < this.n) {
			this.showToast('자모가 부족합니다');
			this.nudge();
			return;
		}
		if (this.invalid) {
			this.showToast('사전에 없는 단어입니다');
			this.nudge();
			return;
		}
		if (this.hard) {
			const v = hardViolation(this.rows, this.marks, this.current);
			if (v) {
				this.showToast(
					v.kind === 'pos' ? `${v.pos + 1}번째 칸은 ${v.jamo}입니다` : `${v.jamo}을(를) 포함해야 합니다`,
					2500
				);
				this.nudge();
				return;
			}
		}
		this.busy = true;
		try {
			const res = await post<GuessResponse>('/api/guess', { token: this.token, jamo: this.current });
			if (!res.ok) {
				this.invalid = true;
				this.showToast('사전에 없는 단어입니다');
				this.nudge();
				return;
			}
			this.rows = [...this.rows, this.current];
			this.marks = [...this.marks, res.marks];
			this.current = '';
			this.invalid = false;

			if (res.marks.every((m) => m === 'c')) await this.finish(true);
			else if (this.rows.length >= this.maxTries) await this.finish(false);
			else if (isDaily(this.config.mode)) this.saveDaily();
		} catch {
			this.showToast('서버에 연결할 수 없습니다');
		} finally {
			this.busy = false;
		}
	}

	private nudge() {
		this.shake = true;
		setTimeout(() => (this.shake = false), 400);
	}

	private async finish(won: boolean) {
		this.status = won ? 'won' : 'lost';
		const { word } = await post<RevealResponse>('/api/reveal', { token: this.token });
		this.answer = word;

		this.recordStats(won, this.rows.length);
		if (isClimb(this.config.mode) && won) {
			this.climbWords = [...this.climbWords, word];
			if (this.stage > this.bestStage) {
				this.bestStage = this.stage;
				save(`best:${configKey(this.config)}`, this.bestStage);
			}
		}
		if (isDaily(this.config.mode)) this.saveDaily();
		if (this.config.mode === 'daily-climb') this.saveDailyClimb();

		if (won) {
			if (this.config.mode === 'climb-length' && this.n === MAX_N) this.showToast(`${MAX_N}자까지 완주!`, 2500);
			else if (isClimb(this.config.mode)) this.showToast(`스테이지 ${this.stage} 클리어`, 2000);
			else this.showToast('정답입니다', 2000);
		} else {
			this.showToast(`정답: ${word}`, 3000);
		}
	}

	private recordStats(won: boolean, tries: number) {
		const s = { ...this.stats, dist: [...this.stats.dist] };
		s.played += 1;
		if (won) {
			s.won += 1;
			s.streak += 1;
			s.maxStreak = Math.max(s.maxStreak, s.streak);
			s.dist[tries - 1] = (s.dist[tries - 1] ?? 0) + 1;
		} else {
			s.streak = 0;
		}
		this.stats = s;
		save(`stats:${this.config.mode}`, s);
	}

	private dailyKey() {
		return `daily:${todayKST()}:${this.token}`;
	}

	private saveDaily() {
		const snap: DailySave = {
			rows: this.rows, marks: this.marks, status: this.status, answer: this.answer, hints: this.hints
		};
		save(this.dailyKey(), snap);
		// 지난 날짜 진행은 다시 열 일이 없으니 지운다. 오늘 것은 데일리·일일 등반 여러 판이 공존하니 남긴다.
		const today = `daily:${todayKST()}:`;
		removeWhere((k) => k.startsWith('daily:') && !k.startsWith(today));
	}

	private saveDailyClimb() {
		const key = `dclimb:${todayKST()}`;
		save(key, { stage: this.stage, n: this.n, climbWords: this.climbWords } satisfies DailyClimbSave);
		removeWhere((k) => k.startsWith('dclimb:') && k !== key);
	}
}
