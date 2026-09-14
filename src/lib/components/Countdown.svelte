<script lang="ts">
	import { dailySecondsLeft } from '$lib/day';
	let { day }: { day: string } = $props();
	// 데일리 계열이 끝난 뒤 다음 코스까지 — 경계는 서버와 같은 KST 자정.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	const left = $derived(dailySecondsLeft(day, now));
	const text = $derived.by(() => {
		const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
		return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
	});
</script>

<div class="next">
	{#if left === 0}
		새 일일 문제가 준비되었습니다. 새로고침하면 풀 수 있습니다.
	{:else}
		다음 단어까지 <b>{text}</b>
	{/if}
</div>

<style>
	.next {
		margin-top: 0.25rem;
		text-align: center;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
