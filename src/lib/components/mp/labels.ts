import type { CompStatus } from '$lib/mp/protocol';
import { STATUS_LABEL } from '$lib/mp/rules';

// 등반에서 스테이지를 못 넘기면 그 판이 끝나는 것이라 '실패'가 아니라 '탈락'으로 말한다(TASKS §2 S3-K).
export const statusLabel = (status: CompStatus, climb: boolean): string => (climb && status === 'failed' ? '탈락' : STATUS_LABEL[status]);
