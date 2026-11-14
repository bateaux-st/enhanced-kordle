import type { Page, Route } from '@playwright/test';
import { hintPos, parseKnown } from '../../src/lib/hint.ts';
import { guessResponse } from '../../src/lib/server/judge.ts';
import type { CheckRequest, CheckResponse, GuessRequest, HintRequest, HintResponse, NewGameRequest, NewGameResponse, RevealRequest, RevealResponse } from '../../src/lib/types.ts';
import { answerOf, toJamo, type Answer } from './words.ts';

type Endpoint = 'game' | 'guess' | 'check' | 'hint' | 'reveal';

export interface SoloOptions {
	/** /api/game이 돌려줄 정답 단어. 배열이면 호출 순서대로(마지막 것을 반복), 함수면 요청마다 정한다. */
	answers: string[] | ((req: NewGameRequest, call: number) => string);
	/** 정답 말고 사전에 있는 단어. 여기에도 없는 열은 "사전에 없는 단어"가 된다. */
	valid?: string[];
}

/**
 * 솔로 API(/api/game, guess, check, hint, reveal)를 서버 없이 대신한다.
 * 판정·힌트 위치는 서버가 쓰는 순수 함수(judge, hintPos)를 그대로 부르고, 토큰은 정답 자모에서 만들어
 * 같은 정답이면 같은 토큰이다(데일리 진행 복원의 키가 토큰이다).
 */
export class SoloApi {
	readonly calls: Record<Endpoint, unknown[]> = { game: [], guess: [], check: [], hint: [], reveal: [] };
	/** 값이 true인 엔드포인트는 500으로 답한다. */
	readonly failing: Partial<Record<Endpoint, boolean>> = {};
	private readonly byToken = new Map<string, Answer>();
	private readonly dict = new Set<string>();
	private gameCalls = 0;

	constructor(private readonly opts: SoloOptions) {
		for (const w of opts.valid ?? []) this.dict.add(toJamo(w));
	}

	async attach(page: Page): Promise<void> {
		await page.route('**/api/game', (r) => this.handle(r, 'game', (b: NewGameRequest) => this.newGame(b)));
		await page.route('**/api/guess', (r) => this.handle(r, 'guess', (b: GuessRequest) => this.guess(b)));
		await page.route('**/api/check', (r) => this.handle(r, 'check', (b: CheckRequest) => ({ valid: this.dict.has(b.jamo) }) satisfies CheckResponse));
		await page.route('**/api/hint', (r) => this.handle(r, 'hint', (b: HintRequest) => this.hint(b)));
		await page.route('**/api/reveal', (r) => this.handle(r, 'reveal', (b: RevealRequest) => ({ word: this.answerOf(b.token).word }) satisfies RevealResponse));
	}

	private async handle<B>(route: Route, name: Endpoint, fn: (body: B) => unknown): Promise<void> {
		const body = route.request().postDataJSON() as B;
		this.calls[name].push(body);
		if (this.failing[name]) return route.fulfill({ status: 500, body: 'mock failure' });
		try {
			await route.fulfill({ json: fn(body) });
		} catch (e) {
			await route.fulfill({ status: 400, body: String(e) });
		}
	}

	private answerOf(token: string): Answer {
		const a = this.byToken.get(token);
		if (!a) throw new Error(`모르는 토큰: ${token}`);
		return a;
	}

	private newGame(req: NewGameRequest): NewGameResponse {
		const call = this.gameCalls++;
		const { answers } = this.opts;
		const word = typeof answers === 'function' ? answers(req, call) : answers[Math.min(call, answers.length - 1)];
		const a = answerOf(word);
		if (req.n !== undefined && req.n !== a.jamo.length) throw new Error(`요청 n=${req.n}인데 정답 ${word}은 ${a.jamo.length}자모`);
		this.dict.add(a.jamo);
		const token = `tok:${a.jamo}`;
		this.byToken.set(token, a);
		return { token, n: a.jamo.length };
	}

	private guess(req: GuessRequest) {
		const a = this.answerOf(req.token);
		if (req.jamo.length !== a.jamo.length) throw new Error('bad guess');
		if (!this.dict.has(req.jamo)) return { ok: false, reason: 'invalid' } as const;
		return guessResponse(a, req.jamo);
	}

	private hint(req: HintRequest): HintResponse {
		const a = this.answerOf(req.token);
		const pos = hintPos(a.jamo, req.jamo, parseKnown(req.known));
		if (pos < 0) throw new Error('no unknown position');
		return { pos };
	}
}

export async function mockSolo(page: Page, opts: SoloOptions): Promise<SoloApi> {
	const api = new SoloApi(opts);
	await api.attach(page);
	return api;
}
