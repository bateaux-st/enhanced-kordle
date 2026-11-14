<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { MpClient } from '$lib/mp/client.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import Icon from './Icon.svelte';
	import { stack } from './modalStack';

	// 640px 이하는 하단 시트, 그 위는 오른쪽 서랍. 투표 시트와 같은 경계다.
	let { client }: { client: MpClient } = $props();

	const id = $props.id();
	const me = Symbol();
	let dlg: HTMLElement | undefined = $state();
	// 소프트 키보드가 올라오면 시트를 그 위에 붙이고 높이를 줄인다. 보이는 영역 기준이라 키보드가 없으면 0이다.
	let kb = $state(0);
	let vvh = $state(0);

	const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

	/** 사용자가 닫았다: 포커스를 여는 버튼으로 돌린다. 투표 시트에 밀려 닫힐 때는 이 함수를 지나지 않으므로 돌리지 않는다. */
	function close() {
		client.chatOpen = false;
		const o = client.chatOpener;
		void tick().then(() => o && document.contains(o) && o.focus());
	}

	onMount(() => {
		stack.push(me);

		const vv = window.visualViewport;
		const sync = () => {
			if (!vv) return;
			kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
			vvh = vv.height;
		};
		sync();
		vv?.addEventListener('resize', sync);
		vv?.addEventListener('scroll', sync);

		function onkeydown(e: KeyboardEvent) {
			if (stack[stack.length - 1] !== me) return;
			if (e.key === 'Escape') {
				// 한글 조합을 취소하는 Esc는 시트를 닫지 않는다.
				if (e.isComposing) return;
				e.preventDefault();
				e.stopPropagation();
				close();
				return;
			}
			if (e.key !== 'Tab' || !dlg) return;
			const f = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (!f.length) return e.preventDefault();
			const first = f[0];
			const last = f[f.length - 1];
			if (!dlg.contains(document.activeElement)) {
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
			vv?.removeEventListener('resize', sync);
			vv?.removeEventListener('scroll', sync);
			stack.splice(stack.indexOf(me), 1);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="scrim" style:--kb="{kb}px" style:--vvh={vvh ? `${vvh}px` : '100dvh'} onclick={(e) => e.target === e.currentTarget && close()}>
	<div bind:this={dlg} class="sheet" role="dialog" aria-modal="true" aria-labelledby={id} tabindex="-1">
		<div class="hd">
			<h2 {id}>채팅</h2>
			<button class="x" type="button" aria-label="닫기" onclick={close}><Icon name="x" size="1.25rem" /></button>
		</div>
		<ChatPanel {client} divider autofocus />
	</div>
</div>

<style>
	/* 결과 모달(30) 위, 접속 끊김 오버레이(36)와 토스트(40) 아래 */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 35;
		display: flex;
		justify-content: flex-end;
		background: var(--scrim);
		animation: mp-fadein var(--mo-fade) ease-out both;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		width: 21.25rem;
		max-width: 100%;
		height: 100vh;
		height: 100dvh;
		border-left: 1px solid var(--line);
		background: var(--surface);
		box-shadow: var(--shadow);
		outline: none;
		animation: chat-side var(--mo-drop) ease-out both;
	}
	.hd {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem 0.5rem 1rem;
		min-height: 3.5rem;
	}
	h2 {
		flex: 1 1 auto;
		font-size: 1rem;
		line-height: 1.5rem;
		font-weight: 700;
	}
	.x {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 0.25rem;
		color: var(--muted);
	}
	.x:hover {
		background: var(--btn-hover);
	}
	@keyframes chat-side {
		from {
			transform: translateX(1rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes chat-up {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@media (max-width: 640px) {
		.scrim {
			align-items: flex-end;
			padding-bottom: var(--kb, 0px);
		}
		.sheet {
			width: 100%;
			height: min(32.5rem, calc(var(--vvh, 100dvh) * 0.85));
			border-left: 0;
			border-radius: 0.75rem 0.75rem 0 0;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
			animation: chat-up var(--mo-drop) ease-out both;
		}
	}
</style>
