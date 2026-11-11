// 클라이언트와 서버가 함께 쓰는 멀티플레이 상수와 순수 검증.
import type { CompStatus, CoopStepView, Pid, Settings } from './protocol.ts';

export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

export const NUDGE_COOLDOWN_MS = 30_000;
/** 방장이 끊긴 뒤 승계까지의 유예. */
export const HOST_GRACE_MS = 5_000;
export const EMPTY_ROOM_MS = 30_000;
export const DISCONNECT_GRACE_MS = 60_000;
export const IDLE_WARNING_MS = 60_000;
/** 협동 힌트 투표가 열려 있는 시간. 넘기면 과반이 안 모인 것으로 보고 부결한다. */
export const HINT_VOTE_MS = 30_000;
/** 부결된 뒤 다시 요청할 수 있기까지. 반대가 이긴 직후 같은 사람이 바로 다시 올리는 것을 막는다. */
export const HINT_VOTE_COOLDOWN_MS = 10_000;
/** 경쟁 등반에서 첫 완주자가 나온 뒤 나머지가 따라올 수 있는 시간. */
export const CLIMB_GRACE_MS = 60_000;
/** 단판 한 판 전체, 그리고 등반 1스테이지의 제한 시간. */
export const TIME_LIMIT_MS = 180_000;
export const CLIMB_STEP_MS = 15_000;
export const CLIMB_MIN_LIMIT_MS = 60_000;
/** 클라이언트가 스테이지 클리어 연출을 보이는 시간. 다음 스테이지 제한 시간은 이 뒤부터 센다. */
export const STAGE_CLEAR_MS = 2_000;
/** 자동 응답(ping)이 이 시간 넘게 없는 소켓은 서버가 닫는다. 클라이언트 ping 주기는 25초. */
export const SOCKET_IDLE_MS = 45_000;
/** 소켓 정리 점검 주기. 게임 중에는 끊김이 탈락·결과를 막으므로 짧게, 대기실·결과는 시작 직전 점검이 있어 길게 둔다. */
export const REAP_CHECK_PLAYING_MS = 45_000;
export const REAP_CHECK_IDLE_MS = 180_000;
/** 클라이언트 ping 주기. 서버는 'pong'을 DO를 깨우지 않고 자동 응답한다. */
export const HEARTBEAT_MS = 25_000;
/** 로비 목록 구독 소켓 경로. /ws/<방 코드>와 겹치지 않는다. */
export const LOBBY_WS_PATH = '/ws-lobby';
/** 로비 소켓이 끊긴 동안만 GET /api/rooms를 이 주기로 부른다. */
export const LOBBY_FALLBACK_POLL_MS = 15_000;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 0 O 1 I 제외 32자. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export const NAME_MIN = 5;
export const NAME_MAX = 12;

/** 상대 패널·결과표·토스트가 같은 말을 쓰도록 한 곳에 둔다. */
export const STATUS_LABEL: Record<CompStatus, string> = {
	playing: '진행 중',
	solved: '정답',
	failed: '실패',
	gaveup: '포기',
	timeout: '시간 초과',
	eliminated: '탈락'
};
export const LENGTH_MIN = 5;
export const LENGTH_MAX = 12;
export const TRIES_MIN = 4;
export const TRIES_MAX = 10;

export const DEFAULT_SETTINGS: Settings = {
	kind: 'comp',
	game: 'single',
	length: 6,
	tries: 6,
	hard: false,
	hints: true,
	timer: false,
	pick: 'vote'
};

/** 닉네임 정규화: NFC, 앞뒤 공백 제거, NAME_MIN..NAME_MAX자(코드포인트). 규칙에 안 맞으면 null. */
export function normalizeName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const name = raw.normalize('NFC').trim();
	const len = [...name].length;
	return len >= NAME_MIN && len <= NAME_MAX ? name : null;
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** 네트워크에서 온 값을 범위 검사하고 알려진 필드만 복사한다. 하나라도 어긋나면 null. */
export function parseSettings(raw: unknown): Settings | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	if (r.kind !== 'coop' && r.kind !== 'comp') return null;
	if (r.game !== 'single' && r.game !== 'climb') return null;
	if (r.length !== 'random' && !isInt(r.length, LENGTH_MIN, LENGTH_MAX)) return null;
	if (!isInt(r.tries, TRIES_MIN, TRIES_MAX)) return null;
	if (typeof r.hard !== 'boolean' || typeof r.hints !== 'boolean' || typeof r.timer !== 'boolean') return null;
	if (r.pick !== 'vote' && r.pick !== 'roulette') return null;
	return { kind: r.kind, game: r.game, length: r.length, tries: r.tries, hard: r.hard, hints: r.hints, timer: r.timer, pick: r.pick };
}

export function sameSettings(a: Settings, b: Settings): boolean {
	return a.kind === b.kind && a.game === b.game && a.length === b.length && a.tries === b.tries && a.hard === b.hard && a.hints === b.hints && a.timer === b.timer && a.pick === b.pick;
}

/**
 * Lobby는 이 시간 안에 알림이 온 방만 목록에 낸다. Room은 접속자가 있는 동안 LOBBY_REFRESH_MS마다 알린다(심장박동).
 * 재시작으로 소켓 없이 남은 방은 알리지 않으므로 STALE 뒤에 목록에서 빠진다. STALE는 REFRESH의 2.5배.
 * 변경은 upsert/remove가 즉시 구독자에게 푸시되므로 이 주기는 목록 정확성이 아니라 유령 방 정리 속도만 정한다.
 */
export const LOBBY_STALE_MS = 750_000;
export const LOBBY_REFRESH_MS = 300_000;
export const LOBBY_LIST_MAX = 50;

/**
 * 협동에서 지금 이 사람이 입력할 것이 남았는지. 무입력 경고의 대상 판정이다.
 * 제안 단계는 아직 제안도 패스도 안 한 사람, 투표 단계는 찍을 후보가 있는데 안 찍은 사람이다.
 */
export function coopNeedsInput(step: CoopStepView, pid: Pid): boolean {
	if (step.kind === 'propose') return !(pid in step.proposals) && !step.passes.includes(pid);
	return step.myVote === null && step.candidates.some((c) => !c.by.includes(pid));
}
