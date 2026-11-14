import type { ChatMsg, Pid } from './protocol.ts';
import { CHAT_KEEP } from './rules.ts';

/** 화면에 그리는 채팅 한 줄. system이면 서버 메시지가 아니라 이 브라우저가 만든 입장·퇴장·방장 변경 줄이다. */
export interface ChatLine {
	/** 이 목록 안에서만 쓰는 번호(그리기 키, 읽음 표시). 서버 id와 무관하다. */
	key: number;
	system: boolean;
	/** 서버 메시지의 id. 시스템 줄은 null. */
	id: number | null;
	pid: Pid | null;
	name: string;
	text: string;
	at: number;
}

/**
 * 최근 CHAT_KEEP줄. 갱신할 때마다 새 배열을 만들어 `lines`에 넣으므로 $state.raw에 그대로 대입할 수 있다.
 * 같은 서버 메시지가 기록(chat_history)과 방송(chat)으로 두 번 와도 한 줄만 남긴다. 키는 id만으로 두지 않고 시각·보낸 사람을 함께 본다:
 * DO가 재시작하면 id가 1부터 다시 시작해 옛 줄과 겹칠 수 있다.
 */
export class ChatFeed {
	lines: ChatLine[] = [];
	private nextKey = 1;

	private has(m: ChatMsg): boolean {
		return this.lines.some((l) => l.id === m.id && l.at === m.at && l.pid === m.pid);
	}

	private line(m: ChatMsg): ChatLine {
		return { key: this.nextKey++, system: false, id: m.id, pid: m.pid, name: m.name, text: m.text, at: m.at };
	}

	private set(lines: ChatLine[]): void {
		this.lines = lines.length > CHAT_KEEP ? lines.slice(-CHAT_KEEP) : lines;
	}

	/** 접속·재접속 때 받은 기록을 합친다. 시각순으로 맞춰 시스템 줄과 섞는다(같은 시각이면 기존 순서). */
	history(msgs: ChatMsg[]): void {
		const added = msgs.filter((m) => !this.has(m)).map((m) => this.line(m));
		if (!added.length) return;
		this.set([...this.lines, ...added].sort((a, b) => a.at - b.at));
	}

	message(m: ChatMsg): void {
		if (!this.has(m)) this.set([...this.lines, this.line(m)]);
	}

	system(text: string, at: number): void {
		this.set([...this.lines, { key: this.nextKey++, system: true, id: null, pid: null, name: '', text, at }]);
	}

	clear(): void {
		this.lines = [];
	}
}
