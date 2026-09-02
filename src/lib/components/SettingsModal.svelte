<script lang="ts">
	import Modal from './Modal.svelte';
	import { DAILY_TRIES, MAX_TRIES, MIN_TRIES } from '$lib/game.svelte';

	let { tries, onchange, onclose }: { tries: number; onchange: (t: number) => void; onclose: () => void } = $props();
</script>

<Modal title="설정" {onclose}>
	<div class="row">
		<div>
			<div class="name">시도 횟수</div>
			<div class="desc">
				{MIN_TRIES}~{MAX_TRIES}회. 다음 게임부터 적용됩니다. 하루 1개 모드는 {DAILY_TRIES}회로 고정.
			</div>
		</div>
		<div class="stepper">
			<button disabled={tries <= MIN_TRIES} onclick={() => onchange(tries - 1)}>−</button>
			<span>{tries}</span>
			<button disabled={tries >= MAX_TRIES} onclick={() => onchange(tries + 1)}>+</button>
		</div>
	</div>
</Modal>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.name {
		font-weight: 700;
	}
	.desc {
		color: var(--slate-500);
		font-size: 0.8rem;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.stepper button {
		width: 2rem;
		height: 2rem;
		border-radius: 0.25rem;
		background: var(--slate-200);
		font-weight: 700;
		font-size: 1.1rem;
	}
	.stepper button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.stepper span {
		min-width: 1.5rem;
		text-align: center;
		font-weight: 700;
		font-size: 1.1rem;
	}
</style>
