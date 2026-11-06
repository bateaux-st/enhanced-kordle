import { readSession, writeSession } from './identity.ts';
import { CLOSE } from './protocol.ts';
import type { ClientMsg, ErrorCode, Pid, ServerMsg, Settings, Snapshot } from './protocol.ts';

export type MpStatus = 'idle' | 'dev' | 'connecting' | 'open' | 'reconnecting' | 'closed';
/** closed일 때 이유. 'left'는 내가 나간 것, 'lost'는 재시도를 다 쓴 것. */
export type CloseReason = 'left' | 'lost' | 'replaced' | 'full' | 'in_progress' | 'no_room' | 'destroyed' | 'bad_name' | null;

const TERMINAL: Record<number, CloseReason> = {
	[CLOSE.REPLACED]: 'replaced',
	[CLOSE.FULL]: 'full',
	[CLOSE.IN_PROGRESS]: 'in_progress',
	[CLOSE.NO_ROOM]: 'no_room',
	[CLOSE.DESTROYED]: 'destroyed',
	1008: 'bad_name'
};

const HEARTBEAT_MS = 25_000;
const RETRY_DELAY_MS = 2_000;

function setRoomParam(code: string | null): void {
	if (typeof history === 'undefined') return;
	const url = new URL(location.href);
	if (code) url.searchParams.set('room', code);
	else url.searchParams.delete('room');
	history.replaceState(history.state, '', url);
}

/**
 * 방 하나와의 WebSocket 세션. 규칙은 전부 서버에 있고 이 클래스는 연결, 최신 스냅샷, 전송만 맡는다.
 * 게임 데이터는 브라우저에 저장하지 않는다(새로고침하면 서버 스냅샷으로 다시 그린다).
 */
export class MpClient {
	status = $state<MpStatus>('idle');
	closeReason = $state<CloseReason>(null);
	/** 스냅샷은 통째로 갈아끼우므로 깊은 반응성이 필요 없다. */
	snap = $state.raw<Snapshot | null>(null);
	pid = $state<Pid | null>(null);
	/** 서버가 확정한 닉네임(충돌 접미사 반영). */
	name = $state('');
	/** 마지막 거절. id가 바뀌면 새 거절이다. */
	error = $state.raw<{ id: number; code: ErrorCode; msg: string } | null>(null);
	/** 마지막 재촉(방장만 받는다). */
	nudge = $state.raw<{ id: number; from: string } | null>(null);
	/** 방장이 "설정 바꾸기"를 눌렀다. 대기실이 한 번 읽고 지운다. */
	wantSettings = $state(false);

	code = '';
	private typedName = '';
	private ws: WebSocket | null = null;
	private attempts = 0;
	private leaving = false;
	private heartbeat: ReturnType<typeof setInterval> | undefined;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private clockOffset = 0;
	private seq = 0;

	/** 서버 시계에 맞춘 지금(ms). 카운트다운 보정용. */
	serverNow(): number {
		return Date.now() + this.clockOffset;
	}

	/** vite dev는 WS 클라이언트가 붙었다 끊기면 죽으므로 연결하지 않는다(R32). 멀티는 build + preview로 본다. */
	connect(code: string, name: string): void {
		if (import.meta.env.DEV) {
			this.status = 'dev';
			return;
		}
		this.close();
		this.code = code;
		this.typedName = name;
		this.leaving = false;
		this.attempts = 0;
		this.seq = 0;
		this.snap = null;
		this.closeReason = null;
		this.wantSettings = false;
		setRoomParam(code);
		document.addEventListener('visibilitychange', this.onVisible);
		this.open();
	}

	/** 재시도를 다 쓰고 멈춘('lost') 뒤 사용자가 누르는 "다시 연결". 시도 횟수를 처음부터 센다. */
	reconnect(): void {
		if (this.status !== 'closed' || this.closeReason !== 'lost') return;
		clearTimeout(this.retryTimer);
		this.attempts = 0;
		this.closeReason = null;
		this.open(true);
	}

	/** 백그라운드에서 재시도를 다 쓴 탭이 다시 보이면 이어 붙는다. 연결 중이거나 열려 있으면 reconnect()가 무시한다. */
	private onVisible = (): void => {
		if (document.visibilityState === 'visible') this.reconnect();
	};

	private open(retry = this.attempts > 0): void {
		this.status = retry ? 'reconnecting' : 'connecting';
		const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${this.code}`);
		this.ws = ws;
		ws.onopen = () => {
			// 재접속에서는 직전 hello가 받은 새 토큰을 읽는다.
			this.sendRaw({ type: 'hello', token: readSession()?.token, name: this.typedName });
			this.heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), HEARTBEAT_MS);
		};
		ws.onmessage = (ev) => {
			if (typeof ev.data === 'string' && ev.data !== 'pong') this.receive(ev.data);
		};
		ws.onclose = (ev) => {
			if (this.ws !== ws) return;
			this.ws = null;
			clearInterval(this.heartbeat);
			this.onClosed(ev.code);
		};
	}

	private receive(raw: string): void {
		let m: ServerMsg;
		try {
			m = JSON.parse(raw) as ServerMsg;
		} catch {
			return;
		}
		if (m.type === 'welcome') {
			this.pid = m.pid;
			this.name = m.name;
		} else if (m.type === 'snap') {
			if (m.snap.seq < this.seq) return; // 역순으로 온 낡은 스냅샷
			this.seq = m.snap.seq;
			this.snap = m.snap;
			this.clockOffset = m.snap.now - Date.now();
			this.status = 'open';
			this.attempts = 0;
			if (m.session) writeSession(m.session, this.typedName);
		} else if (m.type === 'error') {
			this.error = { id: (this.error?.id ?? 0) + 1, code: m.code, msg: m.msg };
		} else if (m.type === 'nudge') {
			this.nudge = { id: (this.nudge?.id ?? 0) + 1, from: m.from };
		} else if (m.type === 'opensettings') {
			this.wantSettings = true;
		}
	}

	/** 끊김: 즉시 1회, 2초 뒤 1회 다시 붙는다. 그래도 안 되면 'lost'로 멈추고 reconnect()가 이어받는다. */
	private onClosed(code: number): void {
		if (this.leaving) return this.finish('left');
		if (code in TERMINAL) return this.finish(TERMINAL[code]);
		this.attempts++;
		this.status = 'reconnecting';
		if (this.attempts === 1) this.open();
		else if (this.attempts === 2) this.retryTimer = setTimeout(() => this.open(), RETRY_DELAY_MS);
		else this.finish('lost');
	}

	private finish(reason: CloseReason): void {
		this.status = 'closed';
		this.closeReason = reason;
		if (reason !== 'lost') setRoomParam(null);
	}

	private close(): void {
		clearTimeout(this.retryTimer);
		clearInterval(this.heartbeat);
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			ws.onclose = null;
			ws.close(1000);
		}
	}

	/** 화면을 떠날 때. 자리는 서버에 남는다(60초 안에 같은 토큰으로 돌아올 수 있다). */
	dispose(): void {
		document.removeEventListener('visibilitychange', this.onVisible);
		this.close();
		this.status = 'idle';
	}

	private sendRaw(msg: ClientMsg): boolean {
		if (this.ws?.readyState !== WebSocket.OPEN) return false;
		this.ws.send(JSON.stringify(msg));
		return true;
	}

	ready(on: boolean) {
		return this.sendRaw({ type: 'ready', on });
	}
	sendNudge() {
		return this.sendRaw({ type: 'nudge' });
	}
	settings(settings: Settings) {
		return this.sendRaw({ type: 'settings', settings });
	}
	/** kickDisconnected: 끊긴 사람을 내보내고 시작. */
	start(kickDisconnected = false) {
		return this.sendRaw({ type: 'start', kickDisconnected });
	}
	/** 방장: 같은 설정으로 대기실로. */
	again() {
		return this.sendRaw({ type: 'again' });
	}
	/** 방장: 대기실로 가서 설정을 바꾼다. settings가 있으면 그 값으로 바꾼다. */
	next(settings?: Settings) {
		return this.sendRaw({ type: 'next', settings });
	}
	guess(jamo: string) {
		return this.sendRaw({ type: 'guess', jamo });
	}
	/** 협동: 입력 중인 글자를 알린다(확정 아님). */
	draft(jamo: string) {
		return this.sendRaw({ type: 'draft', jamo });
	}
	/** 협동: 제안 확정. 마감 전에는 다시 보내 덮어쓸 수 있다. */
	propose(jamo: string) {
		return this.sendRaw({ type: 'propose', jamo });
	}
	/** 협동 방장: 제안(또는 투표)을 지금까지로 마감한다. 소켓을 닫는 close()와 구분한다. */
	closeStep() {
		return this.sendRaw({ type: 'close' });
	}
	vote(candidate: number) {
		return this.sendRaw({ type: 'vote', candidate });
	}
	hint() {
		return this.sendRaw({ type: 'hint' });
	}
	giveUp() {
		return this.sendRaw({ type: 'giveup' });
	}
	eliminate(pid: Pid) {
		return this.sendRaw({ type: 'eliminate', pid });
	}
	/** 나가기: 자리를 버린다. 임시 계정(세션)은 지우지 않는다. */
	leave(): void {
		this.leaving = true;
		this.sendRaw({ type: 'leave' });
		this.close();
		this.snap = null;
		this.pid = null;
		this.finish('left');
	}
}
