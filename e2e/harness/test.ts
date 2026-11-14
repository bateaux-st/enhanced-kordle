import { expect, test as base } from '@playwright/test';
import { Clock } from './clock.ts';
import { FakeLobby } from './lobby.ts';
import { FakeRoom, type RoomOptions } from './room.ts';
import { mockSolo, type SoloApi, type SoloOptions } from './solo.ts';
import type { RoomSummary } from '../../src/lib/mp/protocol.ts';

interface Fixtures {
	clock: Clock;
	/** 방 서버를 세운다. 아직 접속하지 않으므로 room.enter()나 로비에서 들어간다. */
	openRoom: (opts?: RoomOptions) => Promise<FakeRoom>;
	openLobby: (rooms?: RoomSummary[]) => Promise<FakeLobby>;
	solo: (opts: SoloOptions) => Promise<SoloApi>;
}

/**
 * 모든 테스트가 쓰는 기본 fixture. 시계를 멈춰 두고, 서버 밖으로 나가는 요청은 끊고, 페이지의 잡히지 않은 예외를 실패로 친다.
 * 방이나 솔로 API를 mock하는 것은 각 테스트가 harness로 한다.
 */
export const test = base.extend<Fixtures>({
	page: async ({ page }, use) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.route((url) => url.hostname !== 'localhost', (route) => route.abort());
		await use(page);
		expect(errors, '페이지에서 잡히지 않은 예외').toEqual([]);
	},
	clock: [
		async ({ page }, use) => {
			const clock = new Clock(page);
			await clock.install();
			await use(clock);
		},
		{ auto: true }
	],
	openRoom: async ({ page, clock }, use) => {
		const rooms: FakeRoom[] = [];
		await use(async (opts) => {
			const room = await FakeRoom.create(page, clock, opts);
			rooms.push(room);
			return room;
		});
		// 클라이언트가 서버 파서를 통과하지 못하는 메시지를 보냈다면 프로토콜을 어긴 것이다.
		for (const room of rooms) expect(room.invalid, '서버 파서가 거절한 클라이언트 메시지').toEqual([]);
	},
	openLobby: async ({ page, clock }, use) => {
		await use((rooms) => FakeLobby.create(page, clock, rooms));
	},
	solo: async ({ page }, use) => {
		await use((opts) => mockSolo(page, opts));
	}
});

export { expect };
