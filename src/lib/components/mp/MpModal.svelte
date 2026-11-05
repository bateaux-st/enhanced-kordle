<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import { stack } from './modalStack';

	let {
		title,
		onclose,
		small = false,
		over = false,
		initialFocus,
		children
	}: {
		title: string;
		onclose: () => void;
		small?: boolean;
		over?: boolean;
		/** 첫 포커스를 받을 요소의 선택자. 확인 대화상자는 파괴적 버튼이 아니라 취소에 둔다. */
		initialFocus?: string;
		children: Snippet;
	} = $props();

	const id = $props.id();
	const me = Symbol();
	let dialog: HTMLElement;

	const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

	onMount(() => {
		stack.push(me);
		const opener = document.activeElement as HTMLElement | null;
		// 본문 첫 조작 요소에 포커스를 준다. 닫기 버튼이 첫 번째라서 건너뛴다.
		const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const first = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null;
		(first ?? items.find((el) => !el.classList.contains('x')) ?? items[0] ?? dialog).focus();

		function onkeydown(e: KeyboardEvent) {
			if (stack[stack.length - 1] !== me) return;
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				onclose();
				return;
			}
			if (e.key !== 'Tab') return;
			const f = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (!f.length) return e.preventDefault();
			const first = f[0];
			const last = f[f.length - 1];
			if (!dialog.contains(document.activeElement)) {
				e.preventDefault();
				first.focus();
			} else if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
		window.addEventListener('keydown', onkeydown, true);
		return () => {
			window.removeEventListener('keydown', onkeydown, true);
			stack.splice(stack.indexOf(me), 1);
			if (opener && document.contains(opener)) opener.focus();
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="scrim" class:over onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div bind:this={dialog} class="dlg" class:small role="dialog" aria-modal="true" aria-labelledby={id} tabindex="-1">
		<div class="dlg-hd">
			<h2 {id}>{title}</h2>
			<button class="x" type="button" aria-label="닫기" onclick={onclose}><Icon name="x" size="1.25rem" /></button>
		</div>
		<div class="dlg-bd">{@render children()}</div>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--scrim);
		animation: mp-fadein var(--mo-fade) ease-out both;
	}
	.scrim.over {
		z-index: 36;
	}
	.dlg {
		width: 100%;
		max-width: 30rem;
		max-height: calc(100vh - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: var(--shadow);
		outline: none;
		animation: mp-drop var(--mo-drop) ease-out both;
	}
	.dlg.small {
		max-width: 22rem;
	}
	.dlg-hd {
		display: flex;
		align-items: center;
		padding: 1rem 1.25rem 0;
	}
	h2 {
		flex-grow: 1;
		font-size: 1.125rem;
		font-weight: 700;
	}
	.x {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: -0.5rem -0.75rem -0.5rem 0;
		border-radius: 0.25rem;
		color: var(--muted);
	}
	.x:hover {
		background: var(--btn-hover);
	}
	.dlg-bd {
		padding: 0.5rem 1.25rem 1.25rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}
</style>
