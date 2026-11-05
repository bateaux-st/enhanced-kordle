import { DurableObject } from 'cloudflare:workers';
import type { RoomSummary } from '../../mp/protocol.ts';
import { listRooms } from './rooms.ts';

const KEY = 'rooms';

/** 공개 방 목록 싱글턴. 호출은 모두 DO RPC. 항목 하나가 바뀔 때마다 저장 키 하나를 통째로 쓴다. */
export class Lobby extends DurableObject<object> {
	private rooms: Record<string, RoomSummary> = {};

	constructor(ctx: DurableObjectState, env: object) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.rooms = (await ctx.storage.get<Record<string, RoomSummary>>(KEY)) ?? {};
		});
	}

	/** 입장 가능한 방 먼저, 최신순, 최대 50개. 오래 갱신되지 않은 방은 이때 정리한다. */
	async list(): Promise<RoomSummary[]> {
		const { list, pruned } = listRooms(this.rooms, Date.now());
		if (pruned) await this.ctx.storage.put(KEY, this.rooms);
		return list;
	}

	async upsert(summary: RoomSummary): Promise<void> {
		this.rooms[summary.code] = { ...summary, updatedAt: Date.now() };
		await this.ctx.storage.put(KEY, this.rooms);
	}

	async remove(code: string): Promise<void> {
		if (!(code in this.rooms)) return;
		delete this.rooms[code];
		await this.ctx.storage.put(KEY, this.rooms);
	}
}
