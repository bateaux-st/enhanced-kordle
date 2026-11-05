// 메시지 디스패치. hello와 소켓 끊김은 세션·소켓을 아는 DO 셸이 members.join/disconnect를 직접 부른다.
import type { ClientMsg, ErrorCode, Pid } from '../../mp/protocol.ts';
import * as comp from './comp.ts';
import * as members from './members.ts';
import { fail } from './state.ts';
import type { Answer, Result, Rng, RoomState } from './state.ts';
import { abandoned, tick } from './timers.ts';

/** DO 셸이 D1에서 미리 읽어 넘기는 값. 순수 로직은 D1을 부르지 않는다. */
export interface Io {
	/** guess: 추측의 사전 여부. D1 조회가 실패하면 undefined. */
	valid?: boolean;
	/** start: 시작 길이(comp.chooseStartN)와 그 길이의 정답. 조회가 실패하면 undefined. */
	start?: { n: number; answer: Answer };
}

export type Effect =
	| { type: 'error'; to: Pid; code: ErrorCode; msg: string }
	| { type: 'nudge'; to: Pid; from: string }
	/** 방장이 `next`로 설정을 바꾸러 대기실에 간다. */
	| { type: 'open_settings'; to: Pid }
	/** 이 pid의 소켓을 닫는다(나가기). */
	| { type: 'drop'; pid: Pid };

export interface ReduceResult {
	events: Effect[];
	/** 저장·브로드캐스트가 필요한지. */
	changed: boolean;
	/** 방을 지워야 하는지(빈 방 유예 EMPTY_ROOM_MS 경과). */
	destroy: boolean;
}

const START_BLOCKED = {
	phase: () => '이미 시작했습니다',
	no_host: () => '방장이 접속 중이어야 합니다',
	alone: () => '두 명 이상 모여야 시작할 수 있습니다',
	waiting: (n: number) => `${n}명이 아직 준비하지 않았습니다`
};

const UNSUPPORTED = fail('unavailable', '아직 지원하지 않는 기능입니다');

/** 항상 tick(now)부터 돌려 만료된 마감을 먼저 처리한다. */
export function reduce(s: RoomState, pid: Pid, msg: ClientMsg, io: Io, now: number, _rng: Rng): ReduceResult {
	const t = tick(s, now);
	if (t.destroy) return { events: [], changed: false, destroy: true };

	const events: Effect[] = [];
	let changed = t.changed;
	let destroy = false;
	const apply = (r: Result, mutated = true): void => {
		if (!r.ok) events.push({ type: 'error', to: pid, code: r.code, msg: r.msg });
		else if (mutated) changed = true;
	};

	const me = members.findPlayer(s, pid);
	if (!me) {
		apply(fail('forbidden', '방에 없는 사람입니다'));
		return { events, changed, destroy: false };
	}

	switch (msg.type) {
		case 'ready':
			apply(members.setReady(s, pid, msg.on));
			break;
		case 'nudge': {
			const r = members.nudge(s, pid, now);
			apply(r);
			if (r.ok) events.push({ type: 'nudge', to: r.hostPid, from: me.name });
			break;
		}
		case 'leave':
			members.leave(s, pid, now);
			comp.forfeit(s, pid, now);
			events.push({ type: 'drop', pid });
			changed = true;
			// 전원이 나가기로 떠나 자리가 없으면 유예 없이 소멸한다.
			destroy = abandoned(s);
			break;
		case 'settings': {
			const r = members.applySettings(s, pid, msg.settings);
			apply(r, r.ok && r.changed);
			break;
		}
		case 'start':
			apply(start(s, pid, msg.kickDisconnected === true, io, now));
			break;
		case 'guess':
			apply(comp.applyGuess(s, pid, msg.jamo, io.valid, now));
			break;
		case 'hint':
			apply(comp.useHint(s, pid));
			break;
		case 'giveup':
			apply(comp.giveUp(s, pid, now));
			break;
		case 'eliminate':
			apply(comp.eliminate(s, pid, msg.pid, now));
			break;
		case 'again':
			apply(members.backToLobby(s, pid));
			break;
		case 'next': {
			const r = members.backToLobby(s, pid, msg.settings);
			apply(r);
			if (r.ok) events.push({ type: 'open_settings', to: pid });
			break;
		}
		default:
			apply(UNSUPPORTED);
	}
	return { events, changed, destroy };
}

function start(s: RoomState, pid: Pid, kickDisconnected: boolean, io: Io, now: number): Result {
	if (s.hostPid !== pid) return fail('forbidden', '방장만 시작할 수 있습니다');
	const check = members.canStart(s);
	if (!check.ok) return fail(check.reason === 'phase' ? 'phase' : 'forbidden', START_BLOCKED[check.reason!](check.waiting));
	if (s.settings.kind !== 'comp' || s.settings.game !== 'single') return UNSUPPORTED;
	if (!io.start) return fail('unavailable', '서버에 연결할 수 없습니다');
	if (kickDisconnected) members.removeDisconnected(s);
	comp.startGame(s, io.start, now);
	return { ok: true };
}
