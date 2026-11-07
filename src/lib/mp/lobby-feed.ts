import type { RoomSummary } from './protocol.ts';
import { HEARTBEAT_MS, LOBBY_FALLBACK_POLL_MS, LOBBY_WS_PATH } from './rules.ts';

const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;
/** pong이 이만큼 없으면 반쯤 끊긴 소켓으로 보고 버린다. 숨은 탭의 타이머가 1분 주기로 느려져도 넘지 않는 값. */
const DEAD_MS = HEARTBEAT_MS * 3;

/**
 * 로비 목록 구독. 소켓이 열려 있는 동안은 서버가 바뀔 때마다 목록을 밀어 준다.
 * 끊긴 동안은 보이는 탭에서만 onFallback(GET /api/rooms)을 LOBBY_FALLBACK_POLL_MS마다 부르고, 재연결은 지수 백오프로 시도한다.
 * WebSocket이 막힌 망에서 재시도가 요청을 쌓지 않게 백오프를 쓴다. 반환값을 부르면 소켓과 타이머를 모두 정리한다.
 */
export function watchLobby(opts: { onRooms: (rooms: RoomSummary[]) => void; onFallback: () => void }): () => void {
	let ws: WebSocket | null = null;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let retryMs = RETRY_MIN_MS;
	let lastSeen = 0;
	let stopped = false;

	const visible = () => document.visibilityState === 'visible';

	function startPolling() {
		if (pollTimer === undefined) pollTimer = setInterval(() => visible() && opts.onFallback(), LOBBY_FALLBACK_POLL_MS);
	}
	function stopPolling() {
		clearInterval(pollTimer);
		pollTimer = undefined;
	}

	function open() {
		if (stopped || ws) return;
		let sock: WebSocket;
		try {
			sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${LOBBY_WS_PATH}`);
		} catch {
			startPolling();
			return scheduleRetry();
		}
		ws = sock;
		sock.onopen = () => {
			stopPolling();
			lastSeen = Date.now();
			heartbeat = setInterval(() => {
				if (Date.now() - lastSeen > DEAD_MS) return drop(sock);
				if (sock.readyState === WebSocket.OPEN) sock.send('ping');
			}, HEARTBEAT_MS);
		};
		sock.onmessage = (ev) => {
			lastSeen = Date.now();
			if (typeof ev.data !== 'string' || ev.data === 'pong') return;
			try {
				const rooms = JSON.parse(ev.data);
				if (!Array.isArray(rooms)) return;
				retryMs = RETRY_MIN_MS;
				opts.onRooms(rooms as RoomSummary[]);
			} catch {
				/* 형식이 다른 메시지는 버린다 */
			}
		};
		sock.onclose = () => drop(sock);
	}

	/** 끊겼거나 응답이 없는 소켓을 버리고 폴링과 재연결로 넘어간다. */
	function drop(sock: WebSocket) {
		if (ws !== sock) return;
		ws = null;
		clearInterval(heartbeat);
		sock.onclose = null;
		if (sock.readyState <= WebSocket.OPEN) sock.close();
		startPolling();
		scheduleRetry();
	}

	/** 숨은 탭은 기다렸다가 보일 때 붙는다. 백그라운드에서 재시도가 쌓이지 않게 한다. */
	function scheduleRetry() {
		clearTimeout(retryTimer);
		if (stopped) return;
		retryTimer = setTimeout(() => visible() && open(), retryMs);
		retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
	}

	const onVisible = () => {
		if (!visible() || stopped) return;
		// 모바일 절전으로 close 없이 죽은 소켓은 하트비트를 기다리지 않고 바로 버린다.
		if (ws && Date.now() - lastSeen > DEAD_MS) drop(ws);
		if (ws) return;
		clearTimeout(retryTimer);
		opts.onFallback();
		open();
	};

	document.addEventListener('visibilitychange', onVisible);
	open();

	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', onVisible);
		clearTimeout(retryTimer);
		clearInterval(heartbeat);
		stopPolling();
		const sock = ws;
		ws = null;
		if (sock) {
			sock.onclose = null;
			sock.close(1000);
		}
	};
}
