<script lang="ts">
	import MpTimer from './MpTimer.svelte';

	let {
		stage,
		deadline = null,
		cap = null,
		now
	}: {
		stage: number;
		/** 남은 시간 칸을 그릴 때만 마감(ms). null이면 스테이지 칸만 가득 채운다. */
		deadline?: number | null;
		cap?: number | null;
		now: () => number;
	} = $props();
</script>

<!-- 등반의 스테이지와 남은 시간을 한 띠에 둔다. 스테이지가 가장 큰 정보라 큰 숫자로 왼쪽에 둔다 -->
<div class="band" role="group" aria-label={deadline !== null ? '스테이지와 남은 시간' : '스테이지'}>
	<div class="stg">
		<span class="lb">스테이지</span>
		<span class="vl">{stage}</span>
	</div>
	{#if deadline !== null}
		<MpTimer band {deadline} {cap} {now} />
	{/if}
</div>

<style>
	.band {
		display: flex;
		align-items: stretch;
		align-self: stretch;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		overflow: hidden;
	}
	.stg {
		flex: 1;
		padding: 0.5rem 0.875rem;
	}
	.band > :global(.clk) {
		flex: 1;
	}
	.lb {
		display: block;
		font-size: 0.75rem;
		line-height: 1rem;
		font-weight: 500;
		color: var(--muted);
	}
	.vl {
		display: block;
		font-size: 1.5rem;
		line-height: 1.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
</style>
