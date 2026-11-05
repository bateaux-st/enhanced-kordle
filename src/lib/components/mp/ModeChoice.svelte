<script lang="ts">
	import type { Theme } from '$lib/game.svelte';
	import './mp.css';
	import { readSession, writeName } from '$lib/mp/identity';
	import MpSettings from './MpSettings.svelte';
	import NickModal from './NickModal.svelte';

	let {
		theme,
		onthemechange,
		onsolo,
		onmulti
	}: { theme: Theme; onthemechange: (t: Theme) => void; onsolo: () => void; onmulti: () => void } = $props();

	let settings = $state(false);
	let askNick = $state(false);

	// 저장된 닉네임이 있으면 바로 로비로, 없으면 여기서 먼저 받는다.
	function multi() {
		if (readSession()) onmulti();
		else askNick = true;
	}

	// 같이 하기 카드의 장식 격자. c=초록 p=노랑 a=회색 .=빈칸
	const MINI = [['apaac', 'ccacc', '.....'], ['aaapc', 'cpcac', 'ccccc'], ['paaaa', '.....', '.....']];
	// 혼자 하기 카드의 장식 타일. 프로토타입과 같은 "ㄱㄱㅗㄷㅡㄹ".
	const TILES: [string, 'c' | 'p' | 'a'][] = [['ㄱ', 'c'], ['ㄱ', 'c'], ['ㅗ', 'a'], ['ㄷ', 'p'], ['ㅡ', 'a'], ['ㄹ', 'c']];
</script>

<div class="mp">
	<button class="btn gear" type="button" onclick={() => (settings = true)}>설정</button>

	<main class="s0">
		<h1>꼬들</h1>
		<div class="pick-row">
			<button class="pick" type="button" onclick={onsolo}>
				<div class="pick-tiles" aria-hidden="true">
					{#each TILES as [ch, m], i (i)}
						<span class="k-{m}">{ch}</span>
					{/each}
				</div>
				<div>
					<div class="t">혼자 하기</div>
					<div class="d">하루 1개, 등반, 랜덤 무한.</div>
				</div>
			</button>
			<button class="pick main" type="button" onclick={multi}>
				<div class="pick-mini" aria-hidden="true">
					{#each MINI as grid, g (g)}
						<div>
							{#each grid as row, r (r)}
								<div class="r">
									{#each row as ch, i (i)}<i class="k-{ch === '.' ? 'e' : ch}"></i>{/each}
								</div>
							{/each}
						</div>
					{/each}
				</div>
				<div>
					<div class="t">같이 하기</div>
					<div class="d">2~5명이 방에 모여 함께 풀거나 겨룹니다.</div>
				</div>
			</button>
		</div>
	</main>

	{#if askNick}
		<NickModal
			lead="같이 하기에서 쓸 이름을 정하세요."
			confirm="확인"
			onsubmit={(name) => {
				writeName(name);
				askNick = false;
				onmulti();
			}}
			oncancel={() => (askNick = false)}
		/>
	{/if}

	{#if settings}
		<MpSettings {theme} {onthemechange} onclose={() => (settings = false)} />
	{/if}
</div>

<style>
	.s0 {
		min-height: calc(100dvh - 4.5rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2.5rem;
	}
	h1 {
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 700;
	}
	.pick-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		width: 100%;
		max-width: 44rem;
	}
	.pick {
		flex: 1 1 17rem;
		min-height: 12rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 1.5rem;
		border: 2px solid var(--line-strong);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		text-align: left;
		transition: background var(--mo-fast);
	}
	.pick:hover {
		background: var(--btn-hover);
	}
	.pick.main {
		border-color: var(--btn-primary);
		background: var(--btn-primary);
		color: var(--on-tile);
	}
	.pick.main:hover {
		background: var(--btn-primary-hover);
	}
	.t {
		font-size: 1.25rem;
		font-weight: 700;
	}
	.d {
		font-size: 0.875rem;
		line-height: 1.5;
	}
	.pick-tiles {
		display: flex;
		gap: 4px;
	}
	.pick-tiles span {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		font-weight: 700;
		color: var(--on-tile);
	}
	.pick-tiles .k-a {
		color: var(--on-absent);
	}
	.pick-mini {
		display: flex;
		gap: 12px;
	}
	.pick-mini > div {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.r {
		display: flex;
		gap: 3px;
	}
	i {
		width: 14px;
		height: 14px;
		border-radius: 2px;
	}
	.k-c {
		background: var(--tile-correct);
	}
	.k-p {
		background: var(--tile-present);
	}
	.k-a {
		background: var(--tile-absent);
	}
	.k-e {
		border: 1px solid var(--line-strong);
	}
</style>
