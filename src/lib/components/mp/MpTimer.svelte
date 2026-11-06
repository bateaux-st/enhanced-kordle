<script lang="ts">
	import { untrack } from 'svelte';

	let {
		deadline,
		cap = null,
		now
	}: {
		/** 서버 시계 기준 마감(ms). */
		deadline: number;
		/** 보이는 값의 상한(ms). 등반 클리어 연출 2초 동안 새 스테이지 시간을 가득 찬 값에 붙잡아 둔다. */
		cap?: number | null;
		/** 서버 시계로 보정한 지금(ms). */
		now: () => number;
	} = $props();

	const URGENT_MS = 30_000;
	// 스크린 리더에는 매초가 아니라 이 문턱을 지날 때만 알린다.
	const ANNOUNCE_AT = [60, 30, 10];

	let t = $state(untrack(() => now()));
	$effect(() => {
		t = now();
		const id = setInterval(() => (t = now()), 250);
		return () => clearInterval(id);
	});

	const leftMs = $derived(Math.max(0, Math.min(deadline - t, cap ?? Infinity)));
	const secs = $derived(Math.ceil(leftMs / 1000));
	const text = $derived(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);

	let said = $state('');
	let prev = untrack(() => secs);
	let prevDeadline = untrack(() => deadline);
	$effect(() => {
		const s = secs;
		// 등반은 같은 컴포넌트에 새 마감이 들어온다. 이전 스테이지의 값으로 문턱 통과를 판정하지 않고, 같은 문구가 다시 낭독되도록 비운다.
		if (deadline !== prevDeadline) {
			prevDeadline = deadline;
			prev = s;
			said = '';
			return;
		}
		const crossed = ANNOUNCE_AT.find((m) => s <= m && prev > m);
		prev = s;
		if (crossed) said = crossed === 60 ? '남은 시간 1분' : `남은 시간 ${crossed}초`;
	});
</script>

<span class="clk" class:urgent={leftMs <= URGENT_MS}>
	<span aria-hidden="true">남은 시간 {text}</span>
	<span class="sr" role="status">{said}</span>
</span>

<style>
	.clk {
		display: inline-flex;
		align-items: center;
		min-height: 1.75rem;
		padding: 0.125rem 0.75rem;
		border-radius: 0.25rem;
		background: var(--sel-bg);
		color: var(--btn-text);
		font-size: 0.9375rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.clk.urgent {
		background: var(--danger);
		color: var(--on-danger);
	}
</style>
