// 테스트마다 가짜 localStorage를 globalThis에 심고 끝나면 원래대로 돌려놓는다. 반환한 Map이 저장소 내용이다.
export function installLocalStorage(t, initial = {}, overrides = {}) {
	const values = new Map(Object.entries(initial));
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
		getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k),
		...overrides
	} });
	t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
	return values;
}
