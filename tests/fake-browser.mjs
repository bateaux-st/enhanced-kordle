// WebSocket·document·location·history만 최소로 심는다. 끝나면 t.after에서 원래 전역으로 돌려놓는다.
export function installBrowser(t, { href = 'http://x/' } = {}) {
	const names = ['WebSocket', 'document', 'location', 'history'];
	const previous = Object.fromEntries(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
	const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	// t.after는 등록 순서로 돌아 전역 복원이 먼저 끝난다. 정리 함수가 document를 쓰는 경우를 위해 복원 앞에서 돌릴 자리를 둔다.
	const cleanups = [];
	t.after(() => {
		cleanups.forEach((fn) => fn());
		names.forEach((n) => (previous[n] ? Object.defineProperty(globalThis, n, previous[n]) : delete globalThis[n]));
	});

	const sockets = [];
	const env = { sockets, throwOnConstruct: false, last: () => sockets.at(-1), cleanup: (fn) => cleanups.push(fn) };

	class FakeWebSocket {
		static OPEN = 1;
		static CLOSED = 3;
		readyState = 0;
		sent = [];
		closeCode = undefined;
		constructor(url) {
			if (env.throwOnConstruct) {
				env.attempts = (env.attempts ?? 0) + 1;
				throw new Error('blocked');
			}
			this.url = url;
			sockets.push(this);
		}
		send(data) { this.sent.push(data); }
		close(code) { this.readyState = 3; this.closeCode = code; }
		/** 서버가 연결을 열어 준 것. */
		open() { this.readyState = 1; this.onopen?.(); }
		/** 서버가 메시지를 보낸 것. object면 JSON으로 직렬화한다. */
		message(data) { this.onmessage?.({ data: typeof data === 'object' && !(data instanceof ArrayBuffer) ? JSON.stringify(data) : data }); }
		/** 서버나 망이 연결을 끊은 것. */
		drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
	}

	const listeners = new Set();
	const document = {
		visibilityState: 'visible',
		addEventListener: (type, fn) => type === 'visibilitychange' && listeners.add(fn),
		removeEventListener: (type, fn) => type === 'visibilitychange' && listeners.delete(fn)
	};
	env.listeners = listeners;
	env.setVisibility = (state) => {
		document.visibilityState = state;
		[...listeners].forEach((fn) => fn());
	};

	const location = { protocol: new URL(href).protocol, host: new URL(href).host, href };
	const history = { state: null, replaceState: (_s, _t, url) => { location.href = String(url); } };
	define('WebSocket', FakeWebSocket);
	define('document', document);
	define('location', location);
	define('history', history);
	env.location = location;
	return env;
}
