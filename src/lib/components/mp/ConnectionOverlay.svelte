<script lang="ts">
	import { onMount } from 'svelte';

	let {
		kind,
		onlobby,
		onretry
	}: {
		/** reconnect: 자동 재접속 중. lost: 재접속 실패. replaced: 같은 계정이 다른 탭에서 접속. */
		kind: 'reconnect' | 'lost' | 'replaced';
		onlobby: () => void;
		/** lost에서만 쓴다. 시도 횟수를 처음부터 세어 다시 붙는다. */
		onretry: () => void;
	} = $props();

	let box: HTMLElement;
	const id = $props.id();
	// 첫 포커스 이동보다 먼저 잡아야 닫을 때 원래 자리로 돌려줄 수 있다.
	const opener = document.activeElement as HTMLElement | null;

	// 종류가 바뀌면(다시 연결을 누르면 버튼이 사라진다) 포커스를 상자 안으로 되돌린다.
	$effect(() => {
		void kind;
		(box.querySelector<HTMLElement>('button') ?? box).focus();
	});

	// 입력을 막는 오버레이다. 재접속 중에는 누를 것이 없어 포커스를 상자에 두고 Tab을 막는다. 버튼이 둘이면 둘 사이만 돈다.
	onMount(() => {
		const trap = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') return;
			e.preventDefault();
			const btns = [...box.querySelectorAll<HTMLElement>('button')];
			if (!btns.length) return box.focus();
			const at = btns.indexOf(document.activeElement as HTMLElement);
			btns[(at + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
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
			{#if kind === 'lost'}
				<span class="note">네트워크 상태를 확인한 뒤 다시 연결해 보세요.</span>
				<button class="btn primary" type="button" onclick={onretry}>다시 연결</button>
				<button class="btn" type="button" onclick={onlobby}>로비로</button>
			{:else}
				<button class="btn primary" type="button" onclick={onlobby}>로비로</button>
			{/if}
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
