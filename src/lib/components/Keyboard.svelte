<script lang="ts">
	import { KEY_ROWS } from '$lib/jamo';
	import type { Mark } from '$lib/types';

	let { states, onkey }: { states: Record<string, Mark>; onkey: (key: string) => void } = $props();

	const label = (k: string) => (k === 'Enter' ? '입력' : k === 'Backspace' ? '삭제' : k);
</script>

<div class="keyboard">
	{#each KEY_ROWS as row, r (r)}
		<div class="row">
			{#each row as k (k)}
				{@const m = states[k]}
				<button
					class="key"
					class:wide={k.length > 1}
					class:c={m === 'c'}
					class:p={m === 'p'}
					class:a={m === 'a'}
					onclick={() => onkey(k)}
				>
					{label(k)}
				</button>
			{/each}
		</div>
	{/each}
</div>

<style>
	.keyboard {
		/* 원작 40×58, 넓은 키 65.4px. 좁은 화면(9키 행)에서는 폭에 맞춰 줄인다. */
		--kw: min(40px, calc((100vw - 16px) / 9 - 4px));
	}
	.row {
		display: flex;
		justify-content: center;
		margin-bottom: 4px;
	}
	.key {
		width: var(--kw);
		height: 58px;
		margin: 0 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		background: var(--slate-200);
		font-size: 1rem;
		font-weight: 700;
		user-select: none;
	}
	.key:hover {
		background: var(--slate-300);
	}
	.key:active {
		background: var(--slate-400);
	}
	.wide {
		width: calc(var(--kw) * 1.635);
	}
	.c,
	.p,
	.a {
		color: #fff;
	}
	.c {
		background: var(--green-500);
	}
	.c:hover {
		background: var(--green-600);
	}
	.c:active {
		background: var(--green-700);
	}
	.p {
		background: var(--yellow-500);
	}
	.p:hover,
	.p:active {
		background: #ca8a04;
	}
	.a,
	.a:hover,
	.a:active {
		background: var(--slate-400);
	}
</style>
