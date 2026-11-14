import type { Page } from '@playwright/test';

/** 한국 시각 정오. 데일리 날짜가 DAY로 고정되고 자정 카운트다운도 값이 정해진다. */
export const T0 = Date.parse('2026-11-15T12:00:00+09:00');
export const DAY = '2026-11-15';

/**
 * 페이지의 시계를 T0에서 멈춘다. 시간은 run/jump로만 흐르므로 타이머가 몇 초씩 걸려도 테스트는 기다리지 않는다.
 * now는 같은 시각을 서버 쪽(FakeRoom)이 읽는 값이다. 페이지에서 시계를 움직이면 반드시 이 객체를 거친다.
 */
export class Clock {
	now = T0;

	constructor(private readonly page: Page) {}

	async install(): Promise<void> {
		await this.page.clock.install({ time: T0 - 1000 });
		await this.page.clock.pauseAt(T0);
	}

	/** 그 사이의 타이머를 순서대로 모두 실행하며 흐른다. 디바운스·카운트다운 틱이 필요할 때. */
	async run(ms: number): Promise<void> {
		await this.page.clock.runFor(ms);
		this.now += ms;
	}

	/** 사이의 타이머는 한 번씩만 실행하고 건너뛴다. 3분 제한 시간처럼 중간 틱이 필요 없는 큰 점프. */
	async jump(ms: number): Promise<void> {
		await this.page.clock.fastForward(ms);
		this.now += ms;
	}
}
