<script lang="ts">
	import { onMount } from 'svelte';

	let {
		kind,
		onlobby
	}: {
		/** reconnect: 자동 재접속 중. lost: 재접속 실패. replaced: 같은 계정이 다른 탭에서 접속. */
		kind: 'reconnect' | 'lost' | 'replaced';
		onlobby: () => void;
	} = $props();

	let box: HTMLElement;
	const id = $props.id();

	// 입력을 막는 오버레이다. 재접속 중에는 누를 것이 없어 포커스를 상자에 두고 Tab을 막는다.
	onMount(() => {
		const opener = document.activeElement as HTMLElement | null;
		(box.querySelector<HTMLElement>('button') ?? box).focus();
		const trap = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') return;
			e.preventDefault();
			(box.querySelector<HTMLElement>('button') ?? box).focus();
		};
		window.addEventListener('keydown', trap, true);
		return () => {
			window.removeEventListener('keydown', trap, true);
			if (opener && document.contains(opener)) opener.focus();
		};
	});
</script>

<div class="scrim">
	<div bind:this={box} class="box" role="alertdialog" aria-modal="true" aria-labelledby={id} tabindex="-1">
		{#if kind === 'reconnect'}
			<span class="spin big motion-only" aria-hidden="true"></span>
			<span {id}>
				<span class="motion-only">연결이 끊겼습니다. 다시 연결하는 중…</span>
				<span class="rm-only">재접속 중…</span>
			</span>
		{:else}
			<span class="t" {id}>{kind === 'replaced' ? '다른 탭에서 접속했습니다' : '방에 다시 들어갈 수 없습니다'}</span>
			{#if kind === 'replaced'}<span class="note">이 탭은 더 이상 이 방에 연결되어 있지 않습니다.</span>{/if}
			<button class="btn primary" type="button" onclick={onlobby}>로비로</button>
		{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 36;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--scrim);
		animation: mp-fadein var(--mo-fade) ease-out both;
	}
	.box {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		max-width: 100%;
		padding: 1rem 1.25rem;
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: var(--shadow);
		font-size: 0.9rem;
		font-weight: 700;
		outline: none;
	}
	.t {
		flex: 1 0 100%;
	}
	.note {
		flex: 1 0 100%;
		font-weight: 400;
	}
</style>
