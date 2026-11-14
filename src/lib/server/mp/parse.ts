// 네트워크에서 온 문자열을 ClientMsg로. 타입·길이가 어긋나면 null이고, 호출자가 error로 답한다.
import { isJamo, MAX_N } from '../../jamo.ts';
import { parseSettings } from '../../mp/rules.ts';
import type { ClientMsg } from '../../mp/protocol.ts';

export const MAX_RAW_LENGTH = 4096;
const MAX_TOKEN = 512;
const MAX_NAME_RAW = 64;
const MAX_PID = 16;

const isJamoWord = (v: unknown, max = MAX_N): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max && [...v].every(isJamo);

export function parseClientMsg(raw: string): ClientMsg | null {
	if (raw.length > MAX_RAW_LENGTH) return null;
	let m: Record<string, unknown>;
	try {
		const v: unknown = JSON.parse(raw);
		if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
		m = v as Record<string, unknown>;
	} catch {
		return null;
	}
	switch (m.type) {
		case 'hello':
			if (typeof m.name !== 'string' || m.name.length > MAX_NAME_RAW) return null;
			if (m.token !== undefined && (typeof m.token !== 'string' || m.token.length > MAX_TOKEN)) return null;
			return { type: 'hello', token: m.token, name: m.name };
		case 'ready':
			return typeof m.on === 'boolean' ? { type: 'ready', on: m.on } : null;
		case 'nudge':
		case 'leave':
		case 'again':
		case 'close':
		case 'unpropose':
		case 'hint':
		case 'giveup':
			return { type: m.type };
		case 'settings': {
			const settings = parseSettings(m.settings);
			return settings ? { type: 'settings', settings } : null;
		}
		case 'start':
			if (m.kickDisconnected !== undefined && typeof m.kickDisconnected !== 'boolean') return null;
			return { type: 'start', kickDisconnected: m.kickDisconnected };
		case 'next': {
			if (m.settings === undefined) return { type: 'next' };
			const settings = parseSettings(m.settings);
			return settings ? { type: 'next', settings } : null;
		}
		// 초안은 다 지운 빈 문자열도 보낸다.
		case 'draft':
			return typeof m.jamo === 'string' && (m.jamo === '' || isJamoWord(m.jamo)) ? { type: 'draft', jamo: m.jamo } : null;
		case 'propose':
		case 'guess':
			return isJamoWord(m.jamo) ? { type: m.type, jamo: m.jamo } : null;
		case 'pass':
			return typeof m.on === 'boolean' ? { type: 'pass', on: m.on } : null;
		case 'hintvote':
			return typeof m.yes === 'boolean' ? { type: 'hintvote', yes: m.yes } : null;
		case 'vote':
			return typeof m.candidate === 'number' && Number.isInteger(m.candidate) && m.candidate >= 0 && m.candidate < 10 ? { type: 'vote', candidate: m.candidate } : null;
		case 'eliminate':
			return typeof m.pid === 'string' && m.pid.length >= 1 && m.pid.length <= MAX_PID ? { type: 'eliminate', pid: m.pid } : null;
		case 'transfer':
			return typeof m.pid === 'string' && m.pid.length >= 1 && m.pid.length <= MAX_PID ? { type: 'transfer', pid: m.pid } : null;
		default:
			return null;
	}
}
