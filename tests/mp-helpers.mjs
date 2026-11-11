// mp-*.test.mjs 공용 도구. 이름이 .test.mjs로 끝나지 않아 테스트로 실행되지 않는다.
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { initRoom } from '../src/lib/server/mp/state.ts';
import { join } from '../src/lib/server/mp/members.ts';
import { startGame } from '../src/lib/server/mp/comp.ts';
import * as coop from '../src/lib/server/mp/coop.ts';
import { startGame as startCoop } from '../src/lib/server/mp/coop.ts';

export const T0 = 1_000_000;

/** 시드 고정 난수. rng(max)는 [0, max) 정수. */
export function seeded(seed = 1) {
	let a = seed;
	return (max) => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
	};
}

export const rng = seeded(7);

/** 방장 하나가 접속한 대기실. */
export function lobby(settings = {}) {
	const s = initRoom('ABC234', { uid: 'uid-host', name: '방장' }, { ...DEFAULT_SETTINGS, ...settings }, T0, rng);
	join(s, { uid: 'uid-host', name: '방장' }, T0, rng);
	return s;
}

/** 이름 목록만큼 더 입장시키고 pid 목록(방장 포함, 입장 순)을 돌려준다. */
export function joinAll(s, names, now = T0) {
	for (const name of names) {
		const r = join(s, { uid: `uid-${name}`, name }, now, rng);
		if (!r.ok) throw new Error(`join 실패: ${r.reason}`);
	}
	return s.players.map((p) => p.pid);
}

export const ANSWER = { word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' };

/** 방장 + names를 입장시켜 경쟁 단판을 시작한 상태. 정답은 바나나(6). */
export function started(names = ['가', '나'], settings = {}) {
	const s = lobby(settings);
	const pids = joinAll(s, names);
	startGame(s, { n: 6, answer: ANSWER }, T0);
	return { s, pids };
}

/** 협동 힌트 투표를 열고 접속 중인 나머지 참가자가 모두 찬성해 통과시킨다. 요청 결과를 돌려준다. */
export function grantHint(s, requester, now = T0 + 1) {
	const r = coop.useHint(s, requester, now);
	if (!r.ok) return r;
	for (const p of s.players) if (p.inGame && !p.left && p.connected && p.pid !== requester && s.game.hintVote) coop.hintVote(s, p.pid, true, now);
	return r;
}

/** 방장 + names를 입장시켜 협동 단판을 시작한 상태. 정답은 바나나(6). */
export function coopStarted(names = ['가', '나'], settings = {}) {
	const s = lobby({ kind: 'coop', ...settings });
	const pids = joinAll(s, names);
	startCoop(s, { n: 6, answer: ANSWER }, T0);
	return { s, pids };
}

/** 등반용 스테이지 정답. 길이 n마다 자모열이 서로 달라 한 스테이지의 정답이 다른 스테이지의 부분 문자열이 되지 않는다. */
export function stageAnswer(n) {
	return { word: `단어${n}`, jamo: 'ㅂㅏㄴㅏㄴㅏㅁㅏㅁㅏㅁㅏ'.slice(0, n - 1) + 'ㄱㄷㅅㅈㅊㅎㅌㅍ'[n - 5] };
}
/** 정답과 겹치는 자모가 없는 오답(전부 회색). */
export const wrongRow = (n) => 'ㅋ'.repeat(n);
/** startN..12 전체 스테이지 정답. DO 셸이 시작 때 읽어 넘기는 값과 같은 모양. */
export const stagesFrom = (startN) => Object.fromEntries(Array.from({ length: 13 - startN }, (_, i) => [startN + i, stageAnswer(startN + i)]));
export const climbStart = (startN) => ({ n: startN, answer: stageAnswer(startN), stages: stagesFrom(startN) });

/** 방장 + names를 입장시켜 경쟁 등반을 시작한 상태. */
export function compClimbStarted(names = ['가', '나'], settings = {}, startN = 10) {
	const s = lobby({ game: 'climb', ...settings });
	const pids = joinAll(s, names);
	startGame(s, climbStart(startN), T0);
	return { s, pids };
}

/** 방장 + names를 입장시켜 협동 등반을 시작한 상태. */
export function coopClimbStarted(names = ['가', '나'], settings = {}, startN = 10) {
	const s = lobby({ kind: 'coop', game: 'climb', ...settings });
	const pids = joinAll(s, names);
	startCoop(s, climbStart(startN), T0);
	return { s, pids };
}
