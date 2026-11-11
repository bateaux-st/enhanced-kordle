<script lang="ts">
	import { toastState } from './toast.svelte';
</script>

<!-- 알림 영역은 처음부터 DOM에 있어야 스크린리더가 바뀐 문구를 읽는다 -->
<div class="toast-wrap" role="status" aria-live="polite" style:top={toastState.top === null ? null : `${toastState.top}px`}>
	{#key toastState.id}
		{#if toastState.text}
			<div class="toast" class:out={toastState.out}>{toastState.text}</div>
		{/if}
	{/key}
</div>

<style>
	.toast-wrap {
		position: fixed;
		top: calc(4.5rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		max-width: calc(100vw - 2rem);
		pointer-events: none;
	}
	.toast {
		padding: 0.5rem 0.875rem;
		border-radius: 0.375rem;
		background: var(--toast-bg);
		color: var(--toast-text);
		font-size: 0.875rem;
		font-weight: 700;
		text-align: center;
		animation: mp-toastin var(--mo-fade) ease-out both;
	}
	.toast.out {
		animation: mp-fadeout var(--mo-fade) ease-in both;
	}
</style>
