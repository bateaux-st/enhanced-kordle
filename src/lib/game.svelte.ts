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
import { MODE_LABEL } from './types';
import { MAX_N, MIN_N } from './jamo';
import { hardViolation } from './hard';
import { pickHint } from './hint';
import { load, removeWhere, save } from './storage';
import { todayKST } from './day';
import { applyClear, emptyClimbTime, totalOf, type ClimbTimeRecord } from './climbtime';

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
	// 시간 필드는 소요 시간 기능 이전 저장본에 없다. 없으면 그 스테이지 시간을 모르는 것으로 읽는다.
	stageStartAt?: number | null;
	stageTimes?: (number | null)[];
	lostMs?: number | null;
	stageBests?: number[];
	runBest?: boolean;
}

const emptyStats = (): Stats => ({ played: 0, won: 0, streak: 0, maxStreak: 0, dist: [] });

/** 'system'은 기기 설정(prefers-color-scheme)을 따른다. 화면에 실제로 박히는 값은 light/dark 둘뿐. */
export type Theme = 'system' | 'light' | 'dark';

/** localStorage 'settings'에 들어 있는 것. */
interface StoredSettings {
	maxTries: number;
	hard: boolean;
	theme: Theme;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 필드마다 따로 보고 어긋난 것만 기본값으로 읽는다. 저장값은 고쳐 쓰지 않는다.
 * 시도 횟수는 정수면 범위 끝값으로 자르고, 정수가 아니면 기본값이다.
 */
function loadSettings(): StoredSettings {
	const raw = load<unknown>('settings', {});
	const s = isPlainObject(raw) ? raw : {};
	const t = s.maxTries;
	return {
		maxTries: typeof t === 'number' && Number.isInteger(t) ? Math.min(MAX_TRIES, Math.max(MIN_TRIES, t)) : DEFAULT_TRIES,
		hard: s.hard === true,
		theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system'
	};
}

const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const nonNegFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** 받는 모양이 아니면 기록 전체를 없는 것으로 읽는다. 일부만 살리면 최고 기록과 스테이지 기록이 어긋난다. */
function loadClimbTime(key: string): ClimbTimeRecord {
	const raw = load<unknown>(key, null);
	if (!isPlainObject(raw) || !isPlainObject(raw.stages)) return emptyClimbTime();
	const b = raw.best;
	const bestOk = b === null || (isPlainObject(b) && nonNegInt(b.stage) && b.stage >= 1 && nonNegFinite(b.ms));
	return bestOk && Object.values(raw.stages).every(nonNegFinite) ? (raw as unknown as ClimbTimeRecord) : emptyClimbTime();
}

/**
 * 저장된 config가 부팅에 필요한 모양(mode, length)이 아니면 기본값. 손으로 고친 값이 부팅을 막지 않게 한다.
 * 고정 길이가 정수면 범위 안으로 자른다. 첫 판 요청이 400으로 실패하지 않게 하되, 저장값은 고쳐 쓰지 않는다.
 */
function loadConfig(): ModeConfig {
	const fallback: ModeConfig = { mode: 'daily', length: { kind: 'fixed', n: 6 } };
	const c = load<ModeConfig | null>('config', null);
	if (!Object.hasOwn(MODE_LABEL, c?.mode as string)) return fallback;
	const l = c?.length;
	if (l?.kind === 'random') return c as ModeConfig;
	if (l?.kind !== 'fixed' || !Number.isInteger(l.n)) return fallback;
	return { ...(c as ModeConfig), length: { kind: 'fixed', n: Math.min(MAX_N, Math.max(MIN_N, l.n)) } };
}

// 복원 코드가 배열 메서드·스프레드를 바로 부르는 필수 필드만 본다. 어긋나면 저장본이 없는 것으로 읽는다.
const validClimbSave = (s: DailyClimbSave | null): s is DailyClimbSave =>
	typeof s?.stage === 'number' && typeof s.n === 'number' && Array.isArray(s.climbWords);

const validStats = (s: Stats | null): s is Stats =>
	[s?.played, s?.won, s?.streak, s?.maxStreak].every((v) => typeof v === 'number') && Array.isArray(s?.dist);

const validDailySave =(s: DailySave | null): s is DailySave =>
	Array.isArray(s?.rows) &&
	Array.isArray(s.marks) &&
	s.marks.length === s.rows.length &&
	s.marks.every(Array.isArray) &&
	(s.status === 'playing' || s.status === 'won' || s.status === 'lost');

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
	// 자정 뒤에도 같은 코스·저장 날짜를 쓴다. 새로고침으로 Game을 다시 만들 때만 날짜를 바꾼다.
	readonly dailyDay = todayKST();
	config = $state<ModeConfig>(loadConfig());
	// settings 키 하나에 maxTries·hard·theme이 같이 들어간다. 쓰기는 반드시 saveSettings()로 —
	// 한쪽만 save하면 다른 쪽이 지워진다.
	private stored = loadSettings();
	settingTries = $state<number>(this.stored.maxTries);
	/** 하드모드 — 초록 자리와 노랑 자모를 다음 추측에 반드시 다시 쓴다. 기존 사용자의 저장값에는 이 키가 없다(마이그레이션 없음). */
	hard = $state<boolean>(this.stored.hard);
	theme = $state<Theme>(this.stored.theme);

	n = $state(6);
	token = $state('');
	rows = $state<string[]>([]);
	marks = $state<Mark[][]>([]);
	current = $state('');
	/** n자를 다 채웠는데 사전에 없는 열이면 true — 제출 전에 빨간 글자로 알려준다. */
	invalid = $state(false);
	status = $state<Status>('loading');
	/** 보여 줄 이전 판 없이 새 판 요청이 실패했을 때 true. status는 'loading'에 남고 화면은 안내와 '다시 시도'를 띄운다. */
	loadFailed = $state(false);
	answer = $state<string | null>(null);
	/** 힌트로 밝혀진 칸: 위치 → 자모. 입력 행에 흐리게 미리 보여준다. */
	hints = $state<Record<number, string>>({});
	/** 힌트는 한 판에 한 번. hints가 비어 있지 않으면 이미 쓴 것 — 데일리 복원 시에도 그대로 이어진다. */
	hintUsed = $derived(Object.keys(this.hints).length > 0);
	stage = $state(1);
	/** 이번 등반에서 클리어한 정답들 — 종료 시 피라미드로 보여준다. */
	climbWords = $state<string[]>([]);
	bestStage = $state(0);
	/** 지금 스테이지 보드가 뜬 시각(epoch ms). 진행 중이 아니거나 모르면 null. 탭이 숨겨져도 흐르고, 일일 등반은 새로고침 뒤에도 이어진다. */
	stageStartAt = $state<number | null>(null);
	/** 클리어한 스테이지별 시간(ms). 인덱스 = 스테이지 − 1, 모르면 null. */
	stageTimes = $state<(number | null)[]>([]);
	/** 실패(시도 소진·포기)로 끝난 스테이지의 시간. 총 시간에는 넣지 않는다. */
	lostMs = $state<number | null>(null);
	/** 이번 판에서 이전 최단을 깬 스테이지 번호들. */
	stageBests = $state<number[]>([]);
	/** 이번 판이 최고 기록(스테이지, 총 시간)을 새로 썼는지. */
	runBest = $state(false);
	/** climbtime:<configKey> — 최고 기록과 스테이지별 최단. */
	climbTime = $state<ClimbTimeRecord>(emptyClimbTime());
	stats = $state<Stats>(emptyStats());
	busy = $state(false);
	toast = $state<string | null>(null);
	shake = $state(false);

	/** 이 판의 시도 횟수. 판이 시작될 때(clearBoard) 정해 두고, 설정을 바꿔도 다음 판부터 쓴다. */
	maxTries = $state(isDaily(this.config.mode) ? DAILY_TRIES : this.settingTries);
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
		const stats = load<Stats | null>(`stats:${this.config.mode}`, null);
		this.stats = validStats(stats) ? stats : emptyStats();
		const best = load<unknown>(`best:${configKey(this.config)}`, 0);
		this.bestStage = nonNegInt(best) ? best : 0;
		this.climbTime = loadClimbTime(`climbtime:${configKey(this.config)}`);
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
		this.loadFailed = false;
		void this.startRound(false);
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

	setTheme(t: Theme) {
		this.theme = t;
		this.saveSettings();
		this.applyTheme();
	}

	/**
	 * 지금 테마를 문서에 반영한다. 첫 페인트는 app.html의 인라인 스크립트가 이미 처리했고,
	 * 여기가 불리는 건 사용자가 테마를 바꿨거나 'system'인데 기기 설정이 바뀐 경우다.
	 */
	applyTheme() {
		if (typeof document === 'undefined') return;
		const dark =
			this.theme === 'dark' ||
			(this.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.dataset.theme = dark ? 'dark' : 'light';
		// 주소창 색은 app.css의 --bg를 그대로 따라가게 한다. 색값을 두 벌 두지 않으려는 것.
		const meta = document.querySelector('meta[name="theme-color"]');
		const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
		if (meta && bg) meta.setAttribute('content', bg);
	}

	private saveSettings() {
		save('settings', {
			maxTries: this.settingTries,
			hard: this.hard,
			theme: this.theme
		} satisfies StoredSettings);
	}

	/**
	 * 스테이지 1부터(등반) 또는 새 단어로 시작. 일일 등반은 오늘 진행이 있으면 그 스테이지부터.
	 * 끝난 판에서 부르면 응답을 받을 때까지 그 판을 그대로 둔다. 요청 중에는 다시 불러도 무시한다.
	 */
	async newGame() {
		if (this.busy) return;
		await this.startRound(this.status === 'won' || this.status === 'lost');
	}

	/** keep: 끝난 판 화면을 돌아갈 곳으로 남긴다. 모드를 바꿔 시작할 때는 이전 판이 다른 모드라 false. */
	private async startRound(keep: boolean) {
		const daily = this.config.mode === 'daily-climb';
		// 코스는 항상 5자에서 시작해 12자까지 — 모두 같은 코스여야 데일리다.
		const raw = daily ? load<DailyClimbSave | null>(`dclimb:${this.dailyDay}`, null) : null;
		const saved = validClimbSave(raw) ? raw : null;
		if (!keep) {
			this.resetRun(saved);
			this.clearBoard();
		}
		const res = await this.fetchRound(daily ? (saved?.n ?? MIN_N) : this.fixedN());
		if (!res) {
			// 돌아갈 판이 있으면 토스트로 충분하고, 없으면 빈 보드 자리의 안내가 대신 알린다.
			if (keep) this.showToast('서버에 연결할 수 없습니다');
			else this.loadFailed = true;
			return;
		}
		if (keep) this.resetRun(saved);
		this.loadFailed = false;
		this.enterRound(res, saved ? (saved.stageStartAt ?? null) : undefined);
		// 첫 스테이지도 시작 시각을 저장해 두어야 첫 판 도중 새로고침해도 시간이 이어진다.
		if (daily && !saved) this.saveDailyClimb();
	}

	/** 등반 모드에서 클리어 후 다음 스테이지. 길이 상승은 n+1, 연속 클리어는 같은 규칙으로 재추첨. */
	async nextStage() {
		if (this.busy) return;
		const climbsLength = this.config.mode === 'climb-length' || this.config.mode === 'daily-climb';
		const res = await this.fetchRound(climbsLength ? this.n + 1 : this.fixedN());
		// 실패하면 클리어한 판의 보드·스테이지·시간을 그대로 두고, 같은 버튼으로 다시 시도한다.
		if (!res) {
			this.showToast('서버에 연결할 수 없습니다');
			return;
		}
		this.stage += 1;
		this.lostMs = null;
		this.enterRound(res);
		if (this.config.mode === 'daily-climb') this.saveDailyClimb();
	}

	private fixedN() {
		return this.config.length.kind === 'fixed' ? this.config.length.n : undefined;
	}

	/** 등반 진행을 처음(또는 일일 등반 저장본) 상태로 돌린다. */
	private resetRun(saved: DailyClimbSave | null) {
		this.stage = 1;
		this.climbWords = [];
		this.stageTimes = [];
		this.lostMs = null;
		this.stageBests = [];
		this.runBest = false;
		if (!saved) return;
		this.stage = saved.stage;
		this.climbWords = saved.climbWords;
		this.stageTimes = Array.isArray(saved.stageTimes) ? saved.stageTimes : saved.climbWords.map(() => null);
		this.lostMs = saved.lostMs ?? null;
		this.stageBests = Array.isArray(saved.stageBests) ? saved.stageBests : [];
		this.runBest = saved.runBest ?? false;
	}

	private clearBoard() {
		this.maxTries = isDaily(this.config.mode) ? DAILY_TRIES : this.settingTries;
		this.status = 'loading';
		this.stageStartAt = null;
		this.rows = [];
		this.marks = [];
		this.current = '';
		this.invalid = false;
		this.answer = null;
		this.hints = {};
	}

	/** 새 판을 요청한다. 실패하면 null이고 상태는 건드리지 않는다. busy는 요청 중 중복 호출을 막는다. */
	private async fetchRound(n?: number): Promise<NewGameResponse | null> {
		const mode = this.config.mode;
		this.busy = true;
		try {
			return await post<NewGameResponse>('/api/game', {
				mode, n, ...(isDaily(mode) ? { day: this.dailyDay } : {})
			} satisfies NewGameRequest);
		} catch {
			return null;
		} finally {
			this.busy = false;
		}
	}

	/**
	 * 받은 판으로 보드를 연다.
	 * resumeAt: 저장된 스테이지 시작 시각(모르면 null). 생략하면 보드가 뜨는 지금부터 잰다.
	 */
	private enterRound(res: NewGameResponse, resumeAt?: number | null) {
		this.clearBoard();
		this.token = res.token;
		this.n = res.n;

		if (isDaily(this.config.mode)) {
			// 토큰이 n·풀·정답을 함축하므로 날짜와 묶어 키로 쓰면 "오늘 이 판" 진행만 정확히 복원된다.
			const raw = load<DailySave | null>(this.dailyKey(), null);
			const saved = validDailySave(raw) ? raw : null;
			if (saved) {
				this.rows = saved.rows;
				this.marks = saved.marks;
				this.status = saved.status;
				this.answer = saved.answer;
				this.hints = saved.hints ?? {};
				if (saved.status === 'playing') this.stageStartAt = resumeAt !== undefined ? resumeAt : Date.now();
				// 정답을 받기 전에 저장된 진 판이다. enterRound가 동기라 기다리지 않고 띄운다.
				else if (saved.status === 'lost' && !saved.answer) void this.revealAnswer(false);
				return;
			}
		}
		this.status = 'playing';
		this.stageStartAt = resumeAt !== undefined ? resumeAt : Date.now();
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

	/** 노란 판정을 받은 자모 하나의, 보드에서 아직 초록으로 찾지 못한 첫 위치를 알려준다. 한 판에 한 번. 슈퍼겁쟁이용. */
	async hint() {
		if (this.status !== 'playing' || this.busy) return;
		if (this.hintUsed) {
			this.showToast('힌트는 한 판에 한 번입니다');
			return;
		}
		// keyStates는 자모별 최고 판정이라 같은 자모가 초록과 노랑으로 함께 있으면 노랑을 가린다. 보드 칸으로 고른다.
		const pick = pickHint(this.rows, this.marks);
		if (!pick) {
			this.showToast('힌트를 줄 노란 자모가 없습니다');
			return;
		}
		const { jamo, known } = pick;
		this.busy = true;
		try {
			const { pos } = await post<HintResponse>('/api/hint', { token: this.token, jamo, known } satisfies HintRequest);
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

			if (res.marks.every((m) => m === 'c')) await this.finish(true, res.word);
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

	private async finish(won: boolean, revealed?: string) {
		// 시간은 reveal 응답을 기다리기 전에 잰다. 포기 뒤 네트워크 지연이 스테이지 시간에 들어가면 안 된다.
		const endedAt = Date.now();
		this.status = won ? 'won' : 'lost';
		if (isClimb(this.config.mode)) {
			const ms = this.stageStartAt === null ? null : Math.max(0, endedAt - this.stageStartAt);
			this.stageStartAt = null;
			if (won) this.recordClear(ms);
			else this.lostMs = ms;
		}
		if (!won) {
			// 졌다는 사실은 정답 확인(reveal)이 실패해도 남아야 한다. 저장을 먼저 하고 정답은 그 뒤에 받는다.
			this.recordStats(false, this.rows.length);
			if (isDaily(this.config.mode)) this.saveDaily();
			if (this.config.mode === 'daily-climb') this.saveDailyClimb();
			await this.revealAnswer(true);
			return;
		}

		const word = revealed ?? (await post<RevealResponse>('/api/reveal', { token: this.token })).word;
		this.answer = word;
		this.recordStats(true, this.rows.length);
		if (isClimb(this.config.mode)) {
			this.climbWords = [...this.climbWords, word];
			if (this.stage > this.bestStage) {
				this.bestStage = this.stage;
				save(`best:${configKey(this.config)}`, this.bestStage);
			}
		}
		if (isDaily(this.config.mode)) this.saveDaily();
		if (this.config.mode === 'daily-climb') this.saveDailyClimb();

		const completes = this.config.mode === 'climb-length' || this.config.mode === 'daily-climb';
		if (completes && this.n === MAX_N) this.showToast(`${MAX_N}자까지 완주!`, 2500);
		else if (isClimb(this.config.mode)) this.showToast(`스테이지 ${this.stage} 클리어`, 2000);
		else this.showToast('정답입니다', 2000);
	}

	/**
	 * 진 판의 정답을 받아 채운다. 실패해도 던지지 않고 토스트만 띄운다(answer는 null로 남는다).
	 * 복원 경로는 busy를 걸지 않아 응답을 기다리는 사이 다른 판이 열릴 수 있으므로,
	 * 요청 때의 토큰과 같은 진 판에 아직 정답이 없을 때만 반영한다.
	 */
	private async revealAnswer(announce: boolean) {
		const token = this.token;
		let word: string | null;
		try {
			word = (await post<RevealResponse>('/api/reveal', { token })).word;
		} catch {
			word = null;
		}
		if (this.token !== token || this.status !== 'lost' || this.answer) return;
		if (word === null) {
			this.showToast('서버에 연결할 수 없습니다');
			return;
		}
		this.answer = word;
		if (isDaily(this.config.mode)) this.saveDaily();
		if (announce) this.showToast(`정답: ${word}`, 3000);
	}

	/** 클리어한 스테이지 시간을 반영한다. bestStage 갱신보다 먼저 불러야 옛 최고 스테이지를 비교 기준으로 쓸 수 있다. */
	private recordClear(ms: number | null) {
		const times = [...this.stageTimes];
		times[this.stage - 1] = ms;
		this.stageTimes = times;
		const res = applyClear(this.climbTime, {
			stage: this.stage,
			ms,
			totalMs: totalOf(times),
			legacyBestStage: this.bestStage
		});
		this.climbTime = res.rec;
		save(`climbtime:${configKey(this.config)}`, res.rec);
		if (res.stageBest) this.stageBests = [...this.stageBests, this.stage];
		if (res.bestBeaten) this.runBest = true;
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
		return `daily:${this.dailyDay}:${this.token}`;
	}

	private saveDaily() {
		const snap: DailySave = {
			rows: this.rows, marks: this.marks, status: this.status, answer: this.answer, hints: this.hints
		};
		save(this.dailyKey(), snap);
		// 오래 열린 탭이 새 날짜로 연 다른 탭의 진행을 지우지 않도록 이전 날짜만 정리한다.
		removeWhere((k) => k.startsWith('daily:') && k.slice(6, 16) < this.dailyDay);
	}

	private saveDailyClimb() {
		const key = `dclimb:${this.dailyDay}`;
		save(key, {
			stage: this.stage,
			n: this.n,
			climbWords: this.climbWords,
			stageStartAt: this.stageStartAt,
			stageTimes: this.stageTimes,
			lostMs: this.lostMs,
			stageBests: this.stageBests,
			runBest: this.runBest
		} satisfies DailyClimbSave);
		removeWhere((k) => k.startsWith('dclimb:') && k.slice(7, 17) < this.dailyDay);
	}
}
