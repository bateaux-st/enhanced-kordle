// 입장·퇴장·준비·재촉·설정·시작 조건·방장 승계. 모두 state를 제자리에서 바꾼다. 시간은 now 인자.
import { DISCONNECT_GRACE_MS, HOST_GRACE_MS, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, NUDGE_COOLDOWN_MS, parseSettings, sameSettings } from '../../mp/rules.ts';
import type { Pid } from '../../mp/protocol.ts';
import { fail, newPid } from './state.ts';
import type { Player, Result, Rng, RoomState } from './state.ts';

export const findPlayer = (s: RoomState, pid: Pid): Player | undefined => s.players.find((p) => p.pid === pid);
export const isHost = (s: RoomState, pid: Pid): boolean => s.hostPid === pid;
export const connectedCount = (s: RoomState): number => s.players.filter((p) => p.connected).length;

/** 같은 이름이 이미 있으면 "이름(2)", "이름(3)"처럼 접미사를 붙인다. 접미사를 포함해 12자 안에 맞춘다. */
export function uniqueName(players: Player[], name: string, exceptPid?: Pid): string {
	const taken = new Set(players.filter((p) => p.pid !== exceptPid).map((p) => p.name));
	if (!taken.has(name)) return name;
	for (let k = 2; ; k++) {
		const suffix = `(${k})`;
		const cand = [...name].slice(0, NAME_MAX - [...suffix].length).join('') + suffix;
		if (!taken.has(cand)) return cand;
	}
}

export type JoinResult = { ok: true; pid: Pid; name: string; rejoined: boolean } | { ok: false; reason: 'full' | 'in_progress' };

/** 정원이 찼을 때만 호출한다. 끊긴 지 60초가 넘은 사람(방장 제외)의 자리를 비운다. */
function evictStale(s: RoomState, now: number): void {
	s.players = s.players.filter((p) => p.pid === s.hostPid || p.connected || p.disconnectedAt === null || now - p.disconnectedAt < DISCONNECT_GRACE_MS);
}

/**
 * hello를 받은 뒤의 자리 배정. 같은 uid는 기존 자리로 돌아온다(진행 중에도).
 * 신규 입장은 playing이면 거부하고, 정원이 찼으면 오래 끊긴 사람의 자리를 먼저 회수한다.
 */
export function join(s: RoomState, user: { uid: string; name: string }, now: number, rng: Rng): JoinResult {
	const existing = s.players.find((p) => p.uid === user.uid);
	let player: Player;
	if (existing) {
		existing.name = uniqueName(s.players, user.name, existing.pid);
		existing.connected = true;
		existing.disconnectedAt = null;
		existing.ready = false;
		delete existing.left;
		player = existing;
	} else {
		if (s.phase === 'playing') return { ok: false, reason: 'in_progress' };
		if (s.players.length >= MAX_PLAYERS) evictStale(s, now);
		if (s.players.length >= MAX_PLAYERS) return { ok: false, reason: 'full' };
		player = {
			pid: newPid(rng, s.players.map((p) => p.pid)),
			uid: user.uid,
			name: uniqueName(s.players, user.name),
			joinedAt: now,
			connected: true,
			disconnectedAt: null,
			ready: false,
			nudgedAt: null,
			inGame: false
		};
		s.players.push(player);
	}
	s.emptySince = null;
	if (s.hostPid === null) s.hostPid = player.pid;
	return { ok: true, pid: player.pid, name: player.name, rejoined: existing !== undefined };
}

function markEmptyIfNoOneConnected(s: RoomState, now: number): void {
	if (connectedCount(s) === 0 && s.emptySince === null) s.emptySince = now;
}

/** 소켓이 끊겼다. 자리는 남는다. */
export function disconnect(s: RoomState, pid: Pid, now: number): void {
	const p = findPlayer(s, pid);
	if (!p || !p.connected) return;
	p.connected = false;
	p.disconnectedAt = now;
	p.ready = false;
	markEmptyIfNoOneConnected(s, now);
}

/**
 * DO가 재시작되면 소켓은 모두 사라지는데 저장된 connected는 그대로다. 열린 소켓이 없는 접속자를 끊김으로 바꾼다.
 * 바뀐 것이 있으면 true.
 */
export function reconcile(s: RoomState, livePids: Iterable<Pid>, now: number): boolean {
	const live = new Set(livePids);
	let changed = false;
	for (const p of s.players) {
		if (!p.connected || live.has(p.pid)) continue;
		disconnect(s, p.pid, now);
		changed = true;
	}
	return changed;
}

function firstConnectedExcept(s: RoomState, pid: Pid | null): Player | undefined {
	return s.players.find((p) => p.connected && p.pid !== pid);
}

/**
 * 나가기. 진행 중인 참가자는 자리를 남기고 끊김으로 바꾼다(결과 순위표에 이름이 남게 하고, 탈락 처리는 comp가 한다).
 * 방장이 나가면 유예 없이 입장 순으로 접속 중인 다음 사람에게 넘기고, 없으면 방장을 비운다.
 */
export function leave(s: RoomState, pid: Pid, now: number): void {
	const p = findPlayer(s, pid);
	if (!p) return;
	if (s.phase === 'playing' && p.inGame) {
		disconnect(s, pid, now);
		p.left = true;
	} else s.players = s.players.filter((q) => q.pid !== pid);
	if (s.hostPid === pid) s.hostPid = firstConnectedExcept(s, pid)?.pid ?? null;
	markEmptyIfNoOneConnected(s, now);
}

export function setReady(s: RoomState, pid: Pid, on: boolean): Result {
	const p = findPlayer(s, pid);
	if (!p) return fail('forbidden', '방에 없는 사람입니다');
	if (s.phase === 'playing') return fail('phase', '게임 중에는 준비를 바꿀 수 없습니다');
	if (isHost(s, pid)) return fail('forbidden', '방장은 준비하지 않습니다');
	p.ready = on;
	return { ok: true };
}

export function nudge(s: RoomState, pid: Pid, now: number): Result<{ hostPid: Pid }> {
	const p = findPlayer(s, pid);
	if (!p || s.hostPid === null || isHost(s, pid)) return fail('forbidden', '방장에게만 재촉할 수 있습니다');
	if (s.phase === 'playing') return fail('phase', '게임 중에는 재촉할 수 없습니다');
	if (p.nudgedAt !== null && now - p.nudgedAt < NUDGE_COOLDOWN_MS) {
		return fail('cooldown', `${Math.ceil((NUDGE_COOLDOWN_MS - (now - p.nudgedAt)) / 1000)}초 뒤에 다시 재촉할 수 있습니다`);
	}
	p.nudgedAt = now;
	return { ok: true, hostPid: s.hostPid };
}

/** 값이 바뀐 경우에만 전원 준비를 해제한다. */
export function applySettings(s: RoomState, pid: Pid, raw: unknown): Result<{ changed: boolean }> {
	if (!isHost(s, pid)) return fail('forbidden', '방장만 설정을 바꿀 수 있습니다');
	if (s.phase === 'playing') return fail('phase', '게임 중에는 설정을 바꿀 수 없습니다');
	const next = parseSettings(raw);
	if (!next) return fail('forbidden', '설정 값이 올바르지 않습니다');
	const changed = !sameSettings(s.settings, next);
	if (changed) {
		s.settings = next;
		for (const p of s.players) p.ready = false;
	}
	return { ok: true, changed };
}

/**
 * 결과 -> 대기실. 설정은 그대로 두거나 `raw`로 바꾼다. 이전 판 데이터는 모두 버리고 전원 준비를 푼다.
 * 끊긴 채 남은 사람은 자리를 지킨다. 회수는 정원이 찰 때(evictStale)와 시작할 때(removeDisconnected)의 기존 규칙에 맡긴다.
 */
export function backToLobby(s: RoomState, pid: Pid, raw?: unknown): Result {
	if (!isHost(s, pid)) return fail('forbidden', '방장만 다음 게임을 고를 수 있습니다');
	if (s.phase !== 'result') return fail('phase', '결과 화면에서만 고를 수 있습니다');
	let next = s.settings;
	if (raw !== undefined) {
		const parsed = parseSettings(raw);
		if (!parsed) return fail('forbidden', '설정 값이 올바르지 않습니다');
		next = parsed;
	}
	s.settings = next;
	s.game = null;
	s.phase = 'lobby';
	for (const p of s.players) {
		p.ready = false;
		p.inGame = false;
	}
	return { ok: true };
}

export interface StartCheck {
	ok: boolean;
	reason: 'phase' | 'no_host' | 'alone' | 'waiting' | null;
	/** 준비하지 않은 접속자 수(방장 제외). */
	waiting: number;
	/** 끊긴 채 자리를 지키는 사람. 시작을 막지 않는다. */
	disconnected: Pid[];
}

/** 접속한 방장 + 접속한 다른 사람 1명 이상, 접속 중인 방장 외 전원 준비. 끊긴 사람은 세지 않는다. */
export function canStart(s: RoomState): StartCheck {
	const host = s.players.find((p) => p.pid === s.hostPid);
	const waiting = s.players.filter((p) => p.connected && p.pid !== s.hostPid && !p.ready).length;
	const disconnected = s.players.filter((p) => !p.connected).map((p) => p.pid);
	let reason: StartCheck['reason'] = null;
	if (s.phase !== 'lobby') reason = 'phase';
	else if (!host?.connected) reason = 'no_host';
	else if (connectedCount(s) < MIN_PLAYERS) reason = 'alone';
	else if (waiting > 0) reason = 'waiting';
	return { ok: reason === null, reason, waiting, disconnected };
}

/** 시작 때 "내보내고 시작"이면 끊긴 사람을 방에서 뺀다. */
export function removeDisconnected(s: RoomState): void {
	s.players = s.players.filter((p) => p.connected);
}

/** 방장이 끊긴 뒤 승계가 일어날 시각. 이어받을 접속자가 없으면 null. */
export function hostSuccessionAt(s: RoomState): number | null {
	const host = s.players.find((p) => p.pid === s.hostPid);
	if (!host || host.connected || host.disconnectedAt === null) return null;
	return firstConnectedExcept(s, host.pid) ? host.disconnectedAt + HOST_GRACE_MS : null;
}

/** 끊김 유예가 지났으면 입장 순으로 접속 중인 다음 사람에게 방장을 넘긴다. */
export function succeedHost(s: RoomState, now: number): boolean {
	const at = hostSuccessionAt(s);
	if (at === null || now < at) return false;
	s.hostPid = firstConnectedExcept(s, s.hostPid)!.pid;
	return true;
}
