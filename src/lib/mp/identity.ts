// 브라우저에 두는 멀티 정보는 이 키 하나뿐이다(설계 §7). 게임 데이터는 저장하지 않는다.
import { load, removeWhere, save } from '../storage.ts';
import type { SessionInfo } from './protocol.ts';

const KEY = 'mp-session';

export interface StoredSession {
	token: string;
	/** 마지막으로 입력한 닉네임(접미사 전). 입력칸 초기값. */
	name: string;
	/** 만료 시각(ms). 서버가 준 값. */
	exp: number;
}

const isStored = (v: unknown): v is StoredSession => {
	const s = v as Partial<StoredSession> | null;
	return typeof s?.token === 'string' && typeof s.name === 'string' && typeof s.exp === 'number';
};

/** 부팅 시 읽는다. 형식이 틀리거나 만료됐으면 지우고 null(닉네임을 다시 묻는다). */
export function readSession(now = Date.now()): StoredSession | null {
	const s = load<unknown>(KEY, null);
	if (isStored(s) && s.exp >= now) return s;
	if (s !== null) clearSession();
	return null;
}

/** 서버가 준 session을 그대로 덮어쓴다. uid가 바뀌었어도 마찬가지다. */
export function writeSession(session: SessionInfo, name: string): void {
	save(KEY, { token: session.token, name, exp: session.exp } satisfies StoredSession);
}

/** "임시 계정 지우기". 나가기는 이걸 부르지 않는다. */
export function clearSession(): void {
	removeWhere((k) => k === KEY);
}
