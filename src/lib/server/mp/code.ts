// 방 코드. `cloudflare:*` import가 없어 SvelteKit 쪽에서도 쓸 수 있다.
import { CODE_ALPHABET, CODE_LENGTH, CODE_RE } from '../../mp/rules.ts';
import type { Rng } from './state.ts';

export function newCode(rng: Rng): string {
	let code = '';
	for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
	return code;
}

export const isCode = (s: unknown): s is string => typeof s === 'string' && CODE_RE.test(s);
