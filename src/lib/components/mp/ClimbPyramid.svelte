<script lang="ts">
	// 개인 ClimbModal은 Game 객체에 묶여 있어 모양만 옮겼다. 개인 화면은 건드리지 않는다.
	let { words, label = '등반 단어' }: { words: string[]; label?: string } = $props();
	const longest = $derived(Math.max(1, ...words.map((w) => [...w].length)));
</script>

{#if words.length}
	<div class="pyramid" role="img" aria-label="{label}: {words.join(', ')}" style="--n: {longest}">
		{#each words as word, i (i)}
			<div class="row" style="animation-delay: {Math.min(i, 8) * 90}ms" aria-hidden="true">
				{#each [...word] as ch, k (k)}
					<div class="tile">{ch}</div>
				{/each}
			</div>
		{/each}
	</div>
{/if}

<style>
	.pyramid {
		/* 모달 본문 폭(스크림 2rem + 본문 패딩 2.5rem을 뺀 100vw, 데스크톱은 25rem 상한) 안에 칸 사이 gap까지 포함해 12자 행이 들어가도록 줄인다. %는 flex 자식 폭을 0으로 만들어 쓰지 않는다. */
		--gaps: calc(3px * (var(--n) - 1));
		--tile: min(2.25rem, calc((25rem - var(--gaps)) / var(--n)), calc((100vw - 4.75rem - var(--gaps)) / var(--n)));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.row {
		display: flex;
		gap: 3px;
		animation: mp-drop var(--mo-drop) ease-out both;
	}
	.tile {
		width: var(--tile);
		height: var(--tile);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--tile-correct);
		color: var(--on-tile);
		border-radius: 0.2rem;
		font-weight: 700;
		font-size: calc(var(--tile) * 0.5);
	}
</style>
