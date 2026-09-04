<script lang="ts">
	import Modal from './Modal.svelte';
	import type { Game } from '$lib/game.svelte';
	import { MAX_N } from '$lib/jamo';

	let { game, onrestart, onclose }: { game: Game; onrestart: () => void; onclose: () => void } = $props();

	const cleared = $derived(game.climbWords.length);
	const complete = $derived(game.config.mode === 'climb-length' && game.status === 'won' && game.n === MAX_N);
	// 스테이지 1이 꼭대기. 길이 상승 모드에서는 5자→12자로 내려가며 자연히 피라미드가 된다.
	// 실패한 스테이지는 쌓지 않는다 — 정답은 토스트·통계에서 따로 공개된다.
	const title = $derived(complete ? `${MAX_N}자 완주!` : cleared ? `스테이지 ${cleared}까지 올랐습니다` : '첫 스테이지에서 멈췄습니다');
</script>

<Modal title="등반 결과" {onclose}>
	<div class="headline">{title}</div>
	<div class="sub">최고 기록 스테이지 <b>{game.bestStage}</b></div>

	{#if cleared}
		<div class="pyramid" style="--n: {Math.max(...game.climbWords.map((w) => w.length))}">
			{#each game.climbWords as word, i (i)}
				<div class="row" style="animation-delay: {i * 90}ms">
					{#each [...word] as ch, k (k)}
						<div class="tile">{ch}</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}

	{#if game.status === 'lost' && game.answer}
		<div class="answer">멈춘 곳의 정답: <b>{game.answer}</b></div>
	{/if}

	<button class="restart" onclick={onrestart}>{complete ? '다시 등반' : '처음부터'}</button>
</Modal>

<style>
	.headline {
		font-size: 1.1rem;
		font-weight: 700;
		text-align: center;
	}
	.sub {
		text-align: center;
		color: var(--slate-500);
		font-size: 0.8rem;
		margin-bottom: 1rem;
	}
	.pyramid {
		/* 음절 타일. 12자 단어도 모달 내용 폭(26rem − 패딩 ≈ 23rem, 좁은 화면은 100vw 기준) 안에 들어가게 줄인다.
		   %는 flex 자식의 shrink-to-fit 폭을 참조해 0이 되므로 쓰지 않는다. */
		--tile: min(2.25rem, calc(23rem / var(--n)), calc((100vw - 5rem) / var(--n)));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.row {
		display: flex;
		gap: 3px;
		animation: drop 0.3s ease-out both;
	}
	.tile {
		width: var(--tile);
		height: var(--tile);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--green-500);
		color: #fff;
		border-radius: 0.2rem;
		font-weight: 700;
		font-size: calc(var(--tile) * 0.5);
	}
	@keyframes drop {
		from {
			transform: translateY(-8px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	.answer {
		margin-top: 1rem;
		text-align: center;
	}
	.restart {
		margin-top: 1.25rem;
		width: 100%;
		height: 2.75rem;
		border-radius: 0.375rem;
		background: var(--indigo-700);
		color: #fff;
		font-weight: 700;
		font-size: 1rem;
	}
	.restart:hover {
		background: #3730a3;
	}
</style>
