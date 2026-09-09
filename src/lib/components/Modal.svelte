<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="card" role="dialog" aria-modal="true" aria-label={title} tabindex="-1">
		<div class="head">
			<h2>{title}</h2>
			<button aria-label="닫기" onclick={onclose}>✕</button>
		</div>
		<div class="body">{@render children()}</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 10;
	}
	.card {
		background: var(--surface);
		border-radius: 0.5rem;
		width: 100%;
		max-width: 26rem;
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		box-shadow: var(--shadow);
		outline: none;
	}
	.head {
		display: flex;
		align-items: center;
		padding: 1rem 1.25rem 0;
	}
	h2 {
		flex-grow: 1;
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
	}
	.head button {
		font-size: 1.125rem;
		color: var(--muted);
		padding: 0.25rem;
	}
	.body {
		padding: 1rem 1.25rem 1.25rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}
</style>
