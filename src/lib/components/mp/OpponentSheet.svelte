<script lang="ts">
	import type { PlayerView } from '$lib/mp/protocol';
	import Icon from './Icon.svelte';
	import { oppKind, oppLabel } from './labels';

	let {
		id,
		player,
		tries,
		rank = null,
		climb = false,
		canKick = false,
		onkick,
		onclose
	}: {
		id: string;
		player: PlayerView;
		tries: number;
		rank?: number | null;
		climb?: boolean;
		/** 방장 화면에서 끊긴 상대에게 "탈락 처리"를 보인다. 칩에는 자리가 없어 펼친 격자가 맡는다. */
		canKick?: boolean;
		onkick?: () => void;
		onclose: () => void;
	} = $props();

	// 7자부터는 격자 옆에 이름과 상세가 들어갈 폭이 360px에서 모자라 한 줄 위로 올린다.
	const STACK_N = 7;
	const panel = $derived(player.panel);
	const kind = $derived(oppKind(player));
	const label = $derived(oppLabel(player, kind, rank, climb));
	const n = $derived(panel?.n ?? 0);
	const marks = $derived(panel?.marks ?? []);
	const detail = $derived(`${label}${climb && panel ? ` · 스테이지 ${panel.stage}` : ''} · 시도 ${marks.length}/${tries}`);
</script>

<!-- 모바일 칩 아래에 겹쳐 펼치는 상대 격자. 모달이 아니라서 아래 자판과 입력은 그대로 쓴다 -->
<section {id} class="sheet a-drop" class:stack={n >= STACK_N} aria-label="{player.name} 진행 격자" style="--n:{n || 6}">
	<span class="rn" aria-hidden="true">
		{#each { length: tries } as _, r (r)}<span>{r + 1}</span>{/each}
	</span>
	<div class="grid" role="img" aria-label="{player.name}: 제출한 행 {marks.length}개">
		{#each { length: tries } as _, r (r)}
			{#each { length: n } as _, i (i)}<i class="c k-{marks[r]?.[i] ?? 'e'}"></i>{/each}
		{/each}
	</div>
	<div class="info">
		<div class="who">
			<span class="nm" title={player.name}>{player.name}</span>
			<span class="dt">{detail}</span>
			{#if canKick && kind === 'off'}
				<button class="btn kick" type="button" onclick={onkick}>탈락 처리<span class="sr"> {player.name}</span></button>
			{/if}
		</div>
		<button class="btn x" type="button" aria-label="닫기" onclick={onclose}><Icon name="x" /></button>
	</div>
</section>

<style>
	.sheet {
		/* 12자도 오른쪽 이름·닫기 영역이 남도록 폭에 맞춰 줄인다 */
		--c: min(14px, calc((100vw - 11.5rem) / var(--n) - 2px));
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		z-index: 5;
		display: flex;
		gap: 6px;
		padding: 12px;
		border: 1px solid var(--sel-line);
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: var(--shadow);
	}
	.sheet.stack {
		--c: min(14px, calc((100vw - 5.5rem) / var(--n) - 2px));
		flex-wrap: wrap;
	}
	.stack .info {
		order: -1;
		flex: 1 0 100%;
		margin-left: 0;
	}
	.rn {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 10px;
		color: var(--muted);
		font-size: 0.6875rem;
		line-height: var(--c);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.grid {
		flex: none;
		display: grid;
		grid-template-columns: repeat(var(--n), var(--c));
		grid-auto-rows: var(--c);
		gap: 2px;
		align-content: start;
	}
	.c {
		display: block;
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
	.info {
		flex: 1;
		min-width: 0;
		margin-left: 6px;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 4px;
	}
	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.nm {
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dt {
		font-size: 0.8125rem;
		font-weight: 500;
		line-height: 1.3;
		font-variant-numeric: tabular-nums;
	}
	.kick {
		align-self: flex-start;
		margin-top: 0.25rem;
	}
	.x {
		flex: none;
		margin: -8px -8px 0 0;
	}
</style>
