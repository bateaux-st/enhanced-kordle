// 채팅 기록과 속도 제한. RoomState에 넣지 않고 DO 메모리에만 둔다: 저장하면 SQLite 쓰기 한도를 채팅이 먹고,
// DO가 쉬었다 깨면 기록이 사라져도 되기 때문이다. 그래서 이 모듈은 storage를 모른다.
import type { ChatMsg, Pid, ServerMsg } from '../../mp/protocol.ts';
import { CHAT_BURST, CHAT_HISTORY, CHAT_WINDOW_MS } from '../../mp/rules.ts';
import { fail } from './state.ts';
import type { Result, RoomState } from './state.ts';
import { findPlayer } from './members.ts';

export class ChatLog {
	private msgs: ChatMsg[] = [];
	private nextId = 1;
	/**
	 * uid마다 받아들인 메시지의 시각. 대기실에서 나갔다 다시 들어오면 pid가 새로 나오므로 pid로 세면 제한을 우회한다.
	 * 창 밖의 것은 보낼 때마다 걷어 내고, 빈 항목은 지운다.
	 */
	private sent = new Map<string, number[]>();

	/** 최근 기록(오래된 것부터). 복사본이라 호출자가 바꿔도 기록은 그대로다. */
	recent(): ChatMsg[] {
		return [...this.msgs];
	}

	/**
	 * text는 parse가 normalizeChat으로 다듬은 값이다. 단계와 무관하게 자리가 있고 나가지 않은 사람만 보낼 수 있다.
	 * 거절된 메시지는 속도 창에 세지 않는다: 막힌 사람이 계속 눌러도 풀리는 시각이 밀리지 않는다.
	 */
	post(s: RoomState, pid: Pid, text: string, now: number): Result<{ msg: ChatMsg }> {
		const me = findPlayer(s, pid);
		if (!me || me.left) return fail('forbidden', '채팅할 수 없습니다');
		for (const [uid, ts] of this.sent) {
			if (uid !== me.uid && now - ts[ts.length - 1] >= CHAT_WINDOW_MS) this.sent.delete(uid);
		}
		const recent = (this.sent.get(me.uid) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
		if (recent.length >= CHAT_BURST) {
			this.sent.set(me.uid, recent);
			return fail('cooldown', '채팅을 너무 빨리 보내고 있습니다');
		}
		this.sent.set(me.uid, [...recent, now]);
		const msg: ChatMsg = { id: this.nextId++, pid, name: me.name, text, at: now };
		this.msgs.push(msg);
		if (this.msgs.length > CHAT_HISTORY) this.msgs.splice(0, this.msgs.length - CHAT_HISTORY);
		return { ok: true, msg };
	}
}

/** 접속 직후 보내는 기록. 쉬었다 깬 DO는 빈 목록을 보낸다. */
export function historyMsg(log: ChatLog): ServerMsg {
	return { type: 'chat_history', msgs: log.recent() };
}

/**
 * 채팅 한 건의 발송 계획. 거절이면 보낸 사람에게만 error, 받아들이면 자리 있는 열린 소켓 전원에게 chat.
 * 소켓 순회는 DO가 하므로 여기서는 소켓 모양만 받는다(DO 없이 방송 대상을 시험하려고 분리).
 */
export function planChat<W>(
	log: ChatLog,
	s: RoomState,
	sender: { ws: W; pid: Pid },
	text: string,
	now: number,
	peers: { ws: W; pid: Pid | null; open: boolean }[]
): { to: W; msg: ServerMsg }[] {
	const r = log.post(s, sender.pid, text, now);
	if (!r.ok) return [{ to: sender.ws, msg: { type: 'error', code: r.code, msg: r.msg } }];
	return peers.filter((w) => w.pid && w.open).map((w) => ({ to: w.ws, msg: { type: 'chat', msg: r.msg } }));
}
