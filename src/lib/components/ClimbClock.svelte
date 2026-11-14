<script lang="ts">
	import type { Game } from '$lib/game.svelte';
	import { formatTime, spokenTime, totalOf } from '$lib/climbtime';

	let { game }: { game: Game } = $props();

	let now = $state(Date.now());
	$effect(() => {
		if (game.status !== 'playing' || game.stageStartAt === null) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	// 진행 중이면 흐르는 값, 끝났으면 그 스테이지의 확정 시간. 모르면 null('-').
	const stageMs = $derived.by(() => {
		if (game.status === 'playing') return game.stageStartAt === null ? null : Math.max(0, now - game.stageStartAt);
		if (game.status === 'won') return game.stageTimes[game.stage - 1] ?? null;
		if (game.status === 'lost') return game.lostMs;
		return 0;
	});
	// 실패한 스테이지 시간은 총합에 넣지 않는다. 클리어 기록은 이긴 스테이지까지 이미 stageTimes에 들어 있다.
	const totalMs = $derived.by(() => {
		const cleared = totalOf(game.stageTimes);
		if (cleared === null) return null;
		if (game.status !== 'playing') return cleared;
		return stageMs === null ? null : cleared + stageMs;
	});

	// 매초 낭독되지 않게 live region을 쓰지 않는다. 포커스가 들어올 때의 값을 한 번 읽어 준다.
	let label = $state('이번 스테이지와 총 소요 시간');
	const speak = () => (label = `이번 스테이지 ${spokenTime(stageMs)}, 총 ${spokenTime(totalMs)}`);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="clock" role="timer" aria-live="off" tabindex="0" aria-label={label} onfocus={speak}>
	<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
		<path d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
	</svg>
	<span aria-hidden="true" class="lab">이번 스테이지</span>
	<b aria-hidden="true">{formatTime(stageMs)}</b>
	<span class="sep" aria-hidden="true"></span>
	<span aria-hidden="true" class="lab">총 시간</span>
	<b aria-hidden="true">{formatTime(totalMs)}</b>
</div>

<style>
	.clock {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		white-space: nowrap;
		margin: -0.25rem 0 0.75rem;
		font-size: 0.8125rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.clock:focus-visible {
		outline: 2px solid var(--sel-line);
		outline-offset: 2px;
		border-radius: 0.25rem;
	}
	b {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text);
	}
	.sep {
		width: 1px;
		height: 0.875rem;
		margin: 0 0.25rem;
		background: var(--line-strong);
	}
	.ic {
		width: 1rem;
		height: 1rem;
		flex: none;
		fill: none;
		stroke: var(--btn-text);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
