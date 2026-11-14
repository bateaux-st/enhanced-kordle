import type { CompStatus, PlayerView } from '$lib/mp/protocol';
import { STATUS_LABEL } from '$lib/mp/rules';

// 등반에서 스테이지를 못 넘기면 그 판이 끝나는 것이라 '실패'가 아니라 '탈락'으로 말한다(TASKS §2 S3-K).
export const statusLabel = (status: CompStatus, climb: boolean): string => (climb && status === 'failed' ? '탈락' : STATUS_LABEL[status]);

// 경쟁 상대 패널·칩이 공유하는 상태 갈래. 협동의 제안·패스는 OpponentPanel이 따로 얹는다.
export type OppKind = 'playing' | 'off' | 'done' | 'out';
export const oppKind = (p: PlayerView): OppKind => {
	if (!p.panel) return 'out';
	if (p.panel.status === 'solved') return 'done';
	if (p.panel.status !== 'playing') return 'out';
	return p.connected ? 'playing' : 'off';
};
// 끝난 이유(실패·포기·시간 초과·탈락)는 보는 사람이 알아야 하므로 하나로 뭉치지 않는다.
export const oppLabel = (p: PlayerView, kind: OppKind, rank: number | null, climb: boolean): string =>
	kind === 'off'
		? '접속 끊김'
		: kind === 'playing'
			? '풀이 중'
			: kind === 'done'
				? rank
					? `완료 ${rank}위`
					: '완료'
				: p.left
					? '나감'
					: statusLabel(p.panel?.status ?? 'eliminated', climb);
