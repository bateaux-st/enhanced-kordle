<script lang="ts">
	import Modal from './Modal.svelte';
	import { MIN_N, MAX_N } from '$lib/jamo';
	import { MODE_LABEL, type GameMode, type LengthMode } from '$lib/types';
	import type { ModeConfig } from '$lib/game.svelte';

	let { config, onstart, onclose }: { config: ModeConfig; onstart: (c: ModeConfig) => void; onclose: () => void } =
		$props();

	const MODES: { id: GameMode; desc: string }[] = [
		{ id: 'daily', desc: '하루에 한 단어. 모두 같은 문제, 6회 고정.' },
		{ id: 'daily-climb', desc: `하루에 한 코스. ${MIN_N}자에서 ${MAX_N}자까지 모두 같은 순서, 6회 고정.` },
		{ id: 'endless', desc: '끝없이 새 단어. 통계만 쌓입니다.' },
		{ id: 'climb-streak', desc: '연속으로 맞힌 스테이지 수를 올립니다. 실패하면 1로.' },
		{ id: 'climb-length', desc: `맞힐 때마다 한 자모씩 길어져 ${MAX_N}자까지. 실패하면 처음으로.` }
	];
	const NS = Array.from({ length: MAX_N - MIN_N + 1 }, (_, i) => MIN_N + i);

	// 모달을 열 때의 설정을 초기값으로만 쓴다(편집 중 바깥 값이 바뀔 일도 없다).
	// svelte-ignore state_referenced_locally
	let mode = $state<GameMode>(config.mode);
	// svelte-ignore state_referenced_locally
	let pick = $state<number | 'random'>(config.length.kind === 'fixed' ? config.length.n : 'random');

	const lengthTitle = $derived(mode === 'climb-length' ? '시작 길이' : '자모 수');
	// 일일 등반은 코스가 고정(5→12)이라 길이를 고를 게 없다.
	const pickable = $derived(mode !== 'daily-climb');

	function start() {
		const length: LengthMode =
			!pickable ? { kind: 'fixed', n: MIN_N } : pick === 'random' ? { kind: 'random' } : { kind: 'fixed', n: pick };
		onstart({ mode, length });
	}
</script>

<Modal title="게임 모드" {onclose}>
	<div class="modes">
		{#each MODES as m (m.id)}
			<label class:on={mode === m.id}>
				<input type="radio" name="mode" value={m.id} bind:group={mode} />
				<div>
					<div class="name">{MODE_LABEL[m.id]}</div>
					<div class="desc">{m.desc}</div>
				</div>
			</label>
		{/each}
	</div>

	{#if pickable}
		<div class="len-title">{lengthTitle}</div>
		<div class="lens">
			<button class:on={pick === 'random'} onclick={() => (pick = 'random')}>랜덤</button>
			{#each NS as n (n)}
				<button class:on={pick === n} onclick={() => (pick = n)}>{n}</button>
			{/each}
		</div>
	{/if}

	<button class="start" onclick={start}>시작</button>
</Modal>

<style>
	.modes {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	label {
		display: flex;
		gap: 0.625rem;
		align-items: flex-start;
		padding: 0.5rem 0.625rem;
		border: 2px solid var(--slate-200);
		border-radius: 0.375rem;
		cursor: pointer;
	}
	label.on {
		border-color: var(--indigo-500);
		background: var(--indigo-100);
	}
	input {
		margin-top: 0.2rem;
	}
	.name {
		font-weight: 700;
	}
	.desc {
		color: var(--slate-500);
		font-size: 0.8rem;
	}
	.len-title {
		margin: 1rem 0 0.375rem;
		font-weight: 700;
	}
	.lens {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.lens button {
		min-width: 2.25rem;
		height: 2.25rem;
		padding: 0 0.5rem;
		border-radius: 0.25rem;
		background: var(--slate-200);
		font-weight: 700;
	}
	.lens button.on {
		background: var(--indigo-700);
		color: #fff;
	}
	.start {
		margin-top: 1.25rem;
		width: 100%;
		height: 2.75rem;
		border-radius: 0.375rem;
		background: var(--green-500);
		color: #fff;
		font-weight: 700;
		font-size: 1rem;
	}
	.start:hover {
		background: var(--green-600);
	}
</style>
