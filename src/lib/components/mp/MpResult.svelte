<script lang="ts">
	import type { Snapshot } from '$lib/mp/protocol';
	import { STATUS_LABEL } from '$lib/mp/rules';
	import Icon from './Icon.svelte';
	import MpModal from './MpModal.svelte';

	let {
		snap,
		isHost,
		onclose,
		onleave,
		onagain,
		onnext,
		onwait
	}: {
		snap: Snapshot;
		isHost: boolean;
		onclose: () => void;
		onleave: () => void;
		/** 방장: 같은 설정으로 한 판 더. */
		onagain: () => void;
		/** 방장: 설정을 바꾸러 대기실로. */
		onnext: () => void;
		/** 참가자: 결과를 닫고 방장을 기다린다. */
		onwait: () => void;
	} = $props();

	const game = $derived(snap.game);
	const answer = $derived(game ? game.answers?.[game.startN]?.word : undefined);

	// 상태·시도·정답 순서는 순위표가 확정 시점에 들고 있다. 결과 단계에서 사람이 나가 players에서 사라져도 표는 그대로다.
	const rows = $derived(
		(game?.standings ?? []).map((s) => {
			return {
				pid: s.pid,
				name: s.name,
				me: s.pid === snap.you,
				rank: `${s.tied ? '공동 ' : ''}${s.rank}위`,
				result: s.finishOrder !== null ? `${s.finishOrder}번째 정답` : STATUS_LABEL[s.status],
				tries: s.tries
			};
		})
	);
</script>

<MpModal title="결과" {onclose}>
	{#if answer}<p class="big">정답: {answer}</p>{/if}
	<div class="table" role="table" aria-label="순위">
		<div class="trow th" role="row">
			<span role="columnheader">순위</span><span role="columnheader">이름</span><span role="columnheader">결과</span><span role="columnheader" class="tr">시도</span>
		</div>
		{#each rows as x, i (x.pid)}
			<div class="trow" class:mine={x.me} role="row" style="animation-delay:{Math.min(i, 5) * 90}ms">
				<span class="rk" role="cell">{#if i === 0}<span class="first">{x.rank}</span>{:else}{x.rank}{/if}</span>
				<span class="nm" role="cell">{x.name}{#if x.me}<span class="bdg me">나</span>{/if}</span>
				<span class="res" role="cell"><b>{x.result}</b></span>
				<span class="tr" role="cell">{x.tries}</span>
			</div>
		{/each}
	</div>
	<div class="dlg-act">
		{#if isHost}
			<button class="btn primary big block" type="button" onclick={onagain}>같은 설정으로 한 판 더</button>
			<button class="btn big block" type="button" onclick={onnext}>설정 바꾸기</button>
		{:else}
			<p class="wait" role="status">방장이 다음 게임을 고르는 중입니다.</p>
			<button class="btn primary big block" type="button" onclick={onwait}>대기실로</button>
		{/if}
		<button class="btn big block" type="button" onclick={onleave}><Icon name="exit" />나가기</button>
	</div>
</MpModal>

<style>
	.big {
		margin-bottom: 0.75rem;
		font-size: 1.125rem;
		font-weight: 700;
	}
	.table {
		border: 1px solid var(--line);
		border-radius: 0.375rem;
		overflow: hidden;
	}
	.trow {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr) minmax(0, 1.7fr) 3rem;
		column-gap: 0.5rem;
		align-items: center;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--line);
		animation: mp-drop var(--mo-drop) ease-out both;
	}
	.trow.th {
		padding-block: 0.5rem;
		border-top: 0;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--muted);
		animation: none;
	}
	.trow.mine {
		background: var(--sel-bg);
	}
	.rk {
		font-weight: 700;
	}
	.first {
		display: inline-block;
		animation: mp-pop var(--mo-pop) ease-out 0.2s both;
	}
	.nm {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-weight: 700;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.res b {
		display: block;
	}
	.tr {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.dlg-act {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
	.wait {
		text-align: center;
		color: var(--muted);
	}
	@media (max-width: 899.98px) {
		.trow {
			grid-template-columns: 3.75rem minmax(0, 1fr) minmax(0, 1.4fr) 2.25rem;
			column-gap: 0.375rem;
		}
	}
</style>
