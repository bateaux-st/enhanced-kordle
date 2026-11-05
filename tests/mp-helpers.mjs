// mp-*.test.mjs 공용 도구. 이름이 .test.mjs로 끝나지 않아 테스트로 실행되지 않는다.
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { initRoom } from '../src/lib/server/mp/state.ts';
import { join } from '../src/lib/server/mp/members.ts';
import { startGame } from '../src/lib/server/mp/comp.ts';

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
