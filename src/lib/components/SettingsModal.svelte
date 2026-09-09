<script lang="ts">
	import Modal from './Modal.svelte';
	import { DAILY_TRIES, MAX_TRIES, MIN_TRIES } from '$lib/game.svelte';

	let {
		tries,
		hard,
		canEnableHard,
		onchange,
		onhard,
		onclose
	}: {
		tries: number;
		hard: boolean;
		canEnableHard: boolean;
		onchange: (t: number) => void;
		onhard: (on: boolean) => void;
		onclose: () => void;
	} = $props();
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

	<div class="row">
		<div>
			<div class="name">하드모드</div>
			<div class="desc">
				초록 자모는 그 자리에, 노란 자모는 어디든 반드시 다시 써야 합니다.
				{#if !hard && !canEnableHard}
					<b>진행 중인 판에는 켤 수 없습니다.</b> 다음 판을 시작하면 켤 수 있습니다.
				{/if}
			</div>
		</div>
		<button
			class="switch"
			class:on={hard}
			role="switch"
			aria-checked={hard}
			aria-label="하드모드"
			disabled={!hard && !canEnableHard}
			onclick={() => onhard(!hard)}
		>
			<span></span>
		</button>
	</div>
</Modal>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.row + .row {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--slate-200);
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
	.switch {
		flex-shrink: 0;
		width: 2.75rem;
		height: 1.5rem;
		border-radius: 0.75rem;
		background: var(--slate-300);
		padding: 0.1875rem;
		transition: background 0.15s;
	}
	.switch span {
		display: block;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
	}
	.switch.on {
		background: var(--indigo-700);
	}
	.switch.on span {
		transform: translateX(1.25rem);
	}
	.switch:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
