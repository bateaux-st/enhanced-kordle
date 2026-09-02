<script lang="ts">
	import Modal from './Modal.svelte';
	import { isClimb, type Game } from '$lib/game.svelte';
	import { MODE_LABEL } from '$lib/types';

	let { game, onclose }: { game: Game; onclose: () => void } = $props();

	const s = $derived(game.stats);
	const winRate = $derived(s.played ? Math.round((s.won / s.played) * 100) : 0);
	const bars = $derived.by(() => {
		const len = Math.max(game.maxTries, s.dist.length);
		const max = Math.max(1, ...s.dist);
		return Array.from({ length: len }, (_, i) => ({ n: i + 1, v: s.dist[i] ?? 0, w: ((s.dist[i] ?? 0) / max) * 100 }));
	});
	const lengthText = $derived(
		game.config.length.kind === 'fixed' ? `${game.config.length.n}자` : '랜덤'
	);

	// 데일리 종료 후 다음 단어까지 — 경계는 서버와 같은 KST 자정.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	const countdown = $derived.by(() => {
		const kst = new Date(now + 9 * 3600_000);
		const left = 86400 - (kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds());
		const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
		return [h, m, sec].map((x) => String(x).padStart(2, '0')).join(':');
	});
</script>

<Modal title="통계" {onclose}>
	<div class="sub">{MODE_LABEL[game.config.mode]} · {lengthText}</div>

	<div class="tiles">
		<div><b>{s.played}</b><span>플레이</span></div>
		<div><b>{winRate}</b><span>승률 %</span></div>
		<div><b>{s.streak}</b><span>현재 연승</span></div>
		<div><b>{s.maxStreak}</b><span>최다 연승</span></div>
	</div>

	{#if isClimb(game.config.mode)}
		<div class="best">최고 스테이지 <b>{game.bestStage}</b> · 현재 <b>{game.stage}</b></div>
	{/if}

	<h3>시도 분포</h3>
	<div class="dist">
		{#each bars as b (b.n)}
			<div class="bar-row">
				<span class="idx">{b.n}</span>
				<div class="bar" class:hit={game.status === 'won' && game.rows.length === b.n} style="width: {Math.max(b.w, 7)}%">
					{b.v}
				</div>
			</div>
		{/each}
	</div>

	{#if game.status === 'won' || game.status === 'lost'}
		<div class="answer">
			{game.status === 'won' ? '정답' : '이번 정답'}: <b>{game.answer ?? '…'}</b>
		</div>
		{#if game.config.mode === 'daily'}
			<div class="next">다음 단어까지 <b>{countdown}</b></div>
		{/if}
	{/if}
</Modal>

<style>
	.sub {
		color: var(--slate-500);
		font-size: 0.8rem;
		margin-bottom: 0.75rem;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		text-align: center;
	}
	.tiles b {
		display: block;
		font-size: 1.5rem;
	}
	.tiles span {
		font-size: 0.7rem;
		color: var(--slate-500);
	}
	.best {
		margin-top: 0.75rem;
		text-align: center;
	}
	h3 {
		margin: 1rem 0 0.375rem;
		font-size: 0.95rem;
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 3px;
	}
	.idx {
		width: 1.25rem;
		text-align: right;
		font-size: 0.8rem;
	}
	.bar {
		min-width: 1.5rem;
		height: 1.25rem;
		background: var(--slate-400);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 0.375rem;
		border-radius: 0.15rem;
	}
	.bar.hit {
		background: var(--green-500);
	}
	.answer,
	.next {
		margin-top: 0.75rem;
		text-align: center;
	}
	.next {
		margin-top: 0.25rem;
		color: var(--slate-500);
		font-size: 0.85rem;
	}
</style>
