<script lang="ts">
	import { onMount } from 'svelte';
	import { Game, isClimb, type ModeConfig } from '$lib/game.svelte';
	import { CODE_TO_JAMO, MAX_N } from '$lib/jamo';
	import { MODE_LABEL } from '$lib/types';
	import Header, { type Panel } from '$lib/components/Header.svelte';
	import Board from '$lib/components/Board.svelte';
	import Keyboard from '$lib/components/Keyboard.svelte';
	import ModeModal from '$lib/components/ModeModal.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';
	import StatsModal from '$lib/components/StatsModal.svelte';
	import ClimbModal from '$lib/components/ClimbModal.svelte';

	const game = new Game();
	let panel = $state<Panel | 'climb' | null>(null);
	// 포기는 실수 방지로 두 번 눌러 확정. 첫 클릭 후 3초 안에 다시 눌러야 한다.
	let confirmGiveUp = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		void game.newGame();
	});

	// 데일리가 끝나면 원작처럼 통계를, 등반이 끝나면(실패 또는 완주) 피라미드를 띄운다. 타일 애니메이션이 끝날 여유만 준다.
	$effect(() => {
		if (game.status !== 'won' && game.status !== 'lost') return;
		let next: typeof panel = null;
		if (game.config.mode === 'daily') next = 'stats';
		else if (isClimb(game.config.mode) && (game.status === 'lost' || finishedClimb)) next = 'climb';
		if (!next) return;
		const t = setTimeout(() => (panel = next), 1200);
		return () => clearTimeout(t);
	});

	function giveUp() {
		if (!confirmGiveUp) {
			confirmGiveUp = true;
			clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() => (confirmGiveUp = false), 3000);
			return;
		}
		confirmGiveUp = false;
		void game.giveUp();
	}

	function onkey(k: string) {
		if (k === 'Enter') void game.submit();
		else if (k === 'Backspace') game.back();
		else game.type(k);
	}

	function onkeydown(e: KeyboardEvent) {
		if (panel) {
			if (e.key === 'Escape') panel = null;
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const j = CODE_TO_JAMO[e.code];
		if (j) onkey(j);
		else if (e.key === 'Enter' || e.key === 'Backspace') onkey(e.key);
		else return;
		e.preventDefault();
	}

	function startMode(c: ModeConfig) {
		panel = null;
		game.setConfig(c);
	}

	const lengthText = $derived(game.config.length.kind === 'fixed' ? `${game.config.length.n}자` : '랜덤');
	const over = $derived(game.status === 'won' || game.status === 'lost');
	const finishedClimb = $derived(game.config.mode === 'climb-length' && game.status === 'won' && game.n === MAX_N);
</script>

<svelte:window {onkeydown} />

<div class="page">
	<Header title="꼬들 - {game.n}자" onopen={(p) => (panel = p)} />

	<div class="mode-line">
		{MODE_LABEL[game.config.mode]} · {lengthText}
		{#if isClimb(game.config.mode)}
			· 스테이지 <b>{game.stage}</b>
		{/if}
	</div>

	<Board {game} />
	<Keyboard states={game.keyStates} {onkey} />

	<div class="actions">
		<button onclick={() => (panel = 'mode')}>모드 바꾸기</button>
		{#if game.status === 'playing'}
			<button onclick={() => game.hint()} title="노란 자모 하나의 실제 위치를 알려줍니다">힌트</button>
			<button class:danger={confirmGiveUp} onclick={giveUp}>{confirmGiveUp ? '정말 포기?' : '포기'}</button>
		{/if}
		{#if over}
			{#if game.config.mode === 'daily'}
				<button onclick={() => (panel = 'stats')}>통계</button>
			{:else if game.config.mode === 'endless'}
				<button class="primary" onclick={() => game.newGame()}>다음 단어</button>
			{:else if game.status === 'won' && !finishedClimb}
				<button class="primary" onclick={() => game.nextStage()}>다음 스테이지</button>
			{:else}
				<button class="primary" onclick={() => game.newGame()}>
					{finishedClimb ? '다시 등반' : '처음부터'}
				</button>
			{/if}
		{/if}
	</div>

	{#if game.toast}
		<div class="toast">{game.toast}</div>
	{/if}
</div>

{#if panel === 'mode'}
	<ModeModal config={game.config} onstart={startMode} onclose={() => (panel = null)} />
{:else if panel === 'settings'}
	<SettingsModal tries={game.settingTries} onchange={(t) => game.setTries(t)} onclose={() => (panel = null)} />
{:else if panel === 'help'}
	<HelpModal onclose={() => (panel = null)} />
{:else if panel === 'stats'}
	<StatsModal {game} onclose={() => (panel = null)} />
{:else if panel === 'climb'}
	<ClimbModal {game} onrestart={() => { panel = null; void game.newGame(); }} onclose={() => (panel = null)} />
{/if}

<style>
	.page {
		max-width: 80rem;
		margin: 0 auto;
		padding: 2rem 0.5rem;
	}
	.mode-line {
		text-align: center;
		color: var(--slate-500);
		font-size: 0.8rem;
		margin: -1.25rem 0 0.75rem;
	}
	.actions {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 2.5rem;
	}
	/* 원작 하단 버튼(indigo-100 / indigo-700, text-xs) */
	.actions button {
		padding: 0.375rem 0.625rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--indigo-700);
		background: var(--indigo-100);
	}
	.actions button:hover {
		background: var(--indigo-200);
	}
	.actions .primary {
		background: var(--indigo-700);
		color: #fff;
	}
	.actions .primary:hover {
		background: #3730a3;
	}
	.actions .danger {
		background: var(--red-400);
		color: #fff;
	}
	.toast {
		position: fixed;
		top: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--slate-700);
		color: #fff;
		padding: 0.5rem 0.875rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 700;
		z-index: 20;
		pointer-events: none;
	}
</style>
