<script lang="ts">
	import Modal from './Modal.svelte';
	import { DAILY_TRIES, MAX_TRIES, MIN_TRIES, type Theme } from '$lib/game.svelte';

	let {
		tries,
		hard,
		canEnableHard,
		theme,
		onchange,
		onhard,
		onthemechange,
		onclose
	}: {
		tries: number;
		hard: boolean;
		canEnableHard: boolean;
		theme: Theme;
		onchange: (t: number) => void;
		onhard: (on: boolean) => void;
		onthemechange: (t: Theme) => void;
		onclose: () => void;
	} = $props();

	const THEMES: { id: Theme; label: string }[] = [
		{ id: 'system', label: '시스템' },
		{ id: 'light', label: '라이트' },
		{ id: 'dark', label: '다크' }
	];
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

	<div class="block">
		<div class="name">테마</div>
		<div class="desc">기기 설정을 따르거나 직접 고릅니다. 고르는 즉시 적용됩니다.</div>
		<div class="seg">
			{#each THEMES as t (t.id)}
				<button class:on={theme === t.id} aria-pressed={theme === t.id} onclick={() => onthemechange(t.id)}>
					{t.label}
				</button>
			{/each}
		</div>
	</div>
</Modal>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.row + .row,
	.block {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.name {
		font-weight: 700;
	}
	.desc {
		color: var(--muted);
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
		background: var(--key);
		color: var(--on-key);
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
		background: var(--switch-off);
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
		background: var(--btn-primary);
	}
	.switch.on span {
		transform: translateX(1.25rem);
	}
	.switch:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* 표시 설정. 칩 줄은 ModeModal의 '자모 수'(.lens)와 같은 형태를 쓴다. */
	.seg {
		display: flex;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}
	.seg button {
		min-width: 3.5rem;
		height: 2.25rem;
		padding: 0 0.75rem;
		border-radius: 0.25rem;
		background: var(--key);
		color: var(--on-key);
		font-weight: 700;
		font-size: 0.85rem;
	}
	.seg button.on {
		background: var(--btn-primary);
		color: #fff;
	}
</style>
