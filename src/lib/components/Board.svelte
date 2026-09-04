<script lang="ts">
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();

	// 확정 행 + 입력 중인 행 + 빈 행을 maxTries 줄로 편다.
	let grid = $derived.by(() => {
		const out: { jamo: string[]; marks: (string | null)[]; live: boolean }[] = [];
		for (let r = 0; r < game.maxTries; r++) {
			if (r < game.rows.length) {
				out.push({ jamo: [...game.rows[r]], marks: game.marks[r], live: false });
			} else if (r === game.rows.length && game.status === 'playing') {
				const cur = [...game.current];
				out.push({
					jamo: Array.from({ length: game.n }, (_, i) => cur[i] ?? ''),
					marks: Array(game.n).fill(null),
					live: true
				});
			} else {
				out.push({ jamo: Array(game.n).fill(''), marks: Array(game.n).fill(null), live: false });
			}
		}
		return out;
	});
</script>

<div class="board" style="--n: {game.n}">
	{#each grid as row, r (r)}
		<div class="row" class:shake={row.live && game.shake}>
			{#each row.jamo as j, i (i)}
				{@const m = row.marks[i]}
				{@const hint = row.live && !j ? game.hints[i] : undefined}
				<div
					class="cell"
					class:c={m === 'c'}
					class:p={m === 'p'}
					class:a={m === 'a'}
					class:filled={!m && j}
					class:invalid={row.live && game.invalid}
					class:hint={!!hint}
					class:cell-animation={!!j}
				>
					{j || hint || ''}
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.board {
		/* 원작은 56px 고정 6칸. 12칸까지 늘어나므로 화면 폭에 맞춰 줄인다. */
		--tile: min(56px, calc((100vw - 32px) / var(--n) - 4px));
		padding-bottom: 1.5rem;
	}
	.row {
		display: flex;
		justify-content: center;
		margin-bottom: 4px;
	}
	.cell {
		width: var(--tile);
		height: var(--tile);
		margin: 0 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--slate-200);
		border-radius: 0.25rem;
		background: #fff;
		font-size: calc(var(--tile) * 0.43);
		font-weight: 700;
		color: var(--text);
		user-select: none;
	}
	.filled {
		border-color: var(--slate-400);
	}
	.invalid {
		color: var(--red-400);
	}
	/* 힌트로 밝혀진 칸 — 입력 전에는 흐리게, 노란 점선 테두리 */
	.hint {
		color: var(--slate-300);
		border-style: dashed;
		border-color: var(--yellow-500);
	}
	.c,
	.p,
	.a {
		color: #fff;
	}
	.c {
		background: var(--green-500);
		border-color: var(--green-500);
	}
	.p {
		background: var(--yellow-500);
		border-color: var(--yellow-500);
	}
	.a {
		background: var(--slate-400);
		border-color: var(--slate-400);
	}

	@keyframes shake {
		10%,
		90% {
			transform: translateX(-2px);
		}
		20%,
		80% {
			transform: translateX(4px);
		}
		30%,
		50%,
		70% {
			transform: translateX(-6px);
		}
		40%,
		60% {
			transform: translateX(6px);
		}
	}
	.shake {
		animation: shake 0.4s;
	}
</style>
