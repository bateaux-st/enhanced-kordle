// 모든 진행·통계·설정은 브라우저 localStorage에만 둔다. 계정이 없는 게임이라 서버가 사용자 상태를 가질 이유가 없다.
const PREFIX = 'nkordle:';

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function load<T>(key: string, fallback: T): T {
	try {
		const raw = store()?.getItem(PREFIX + key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

export function save(key: string, value: unknown) {
	try {
		store()?.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		/* 저장 실패는 게임 진행을 막지 않는다 */
	}
}

export function removeWhere(pred: (key: string) => boolean) {
	const s = store();
	if (!s) return;
	for (let i = s.length - 1; i >= 0; i--) {
		const k = s.key(i);
		if (k?.startsWith(PREFIX) && pred(k.slice(PREFIX.length))) s.removeItem(k);
	}
}
