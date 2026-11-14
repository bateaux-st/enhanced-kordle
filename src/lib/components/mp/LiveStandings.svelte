<script lang="ts">
	import type { PlayerView, Standing } from '$lib/mp/protocol';
	import { liveRows } from '$lib/mp/live-rank';
	import { statusLabel } from './labels';

	let {
		standings,
		players,
		you,
		climb
	}: {
		standings: Standing[];
		players: PlayerView[];
		you: string;
		climb: boolean;
	} = $props();

	const rows = $derived(liveRows(standings));
	const waiting = $derived(standings.some((s) => s.status === 'playing'));
	// 스테이지는 지금 서 있는 스테이지다. 순위표의 height는 클리어한 수라 하나 적다.
	const stageOf = (s: Standing) => players.find((p) => p.pid === s.pid)?.panel?.stage ?? (s.height ?? 0) + 1;
	const sub = (s: Standing) => (s.finishOrder !== null ? `${s.finishOrder}번째 ${climb ? '완주' : '정답'}` : statusLabel(s.status, climb));
</script>

<section class="ls" aria-labelledby="ls-t">
	<div class="hd">
		<h2 id="ls-t">현재 순위</h2>
		{#if waiting}<span class="prov">잠정</span>{/if}
	</div>
	<div role="table" aria-label={waiting ? '현재 순위(잠정)' : '현재 순위'}>
		<div class="row th" role="row">
			<span role="columnheader">순위</span>
			<span role="columnheader">이름</span>
			<span role="columnheader" class="tr">{climb ? '스테이지' : '시도'}</span>
		</div>
		{#each rows as { s, shown, tied } (s.pid)}
			<div class="row" class:mine={s.pid === you} role="row">
				<span role="cell" class="rk">
					{#if shown !== null}{tied ? '공동 ' : ''}{shown}위{:else}<span class="wt">풀이 중</span>{/if}
				</span>
				<div role="cell" class="who">
					<span class="nm" title={s.name}>{s.name}</span>
					{#if shown !== null}
						<span class="sb">{sub(s)}{#if s.pid === you}<span class="bdg me">나</span>{/if}</span>
					{/if}
				</div>
				<span role="cell" class="tr val">{climb ? stageOf(s) : s.tries}</span>
			</div>
		{/each}
	</div>
	{#if waiting}<p class="ft">풀이 중인 사람이 끝나면 순위가 바뀔 수 있습니다.</p>{/if}
</section>

<style>
	.ls {
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		overflow: hidden;
	}
	.hd {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
	}
	h2 {
		font-size: 1rem;
		line-height: 1.5rem;
		font-weight: 700;
	}
	.prov {
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--sel-bg);
		color: var(--btn-text);
		font-size: 0.6875rem;
		line-height: 1rem;
		font-weight: 700;
	}
	.row {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr) 3.25rem;
		column-gap: 0.5rem;
		align-items: center;
		min-height: 56px;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--line);
	}
	.row.th {
		min-height: 0;
		padding-block: 0.375rem;
		font-size: 0.75rem;
		line-height: 1rem;
		font-weight: 700;
		color: var(--muted);
	}
	.row.mine {
		background: var(--sel-bg);
	}
	.rk {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* 풀이 중은 순위가 아니라 상태라서 회색 칩으로 숫자와 구별한다 */
	.wt {
		display: inline-block;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--key);
		color: var(--on-key);
		font-size: 0.6875rem;
		line-height: 1rem;
		font-weight: 700;
	}
	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.nm {
		font-size: 1rem;
		line-height: 1.5rem;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sb {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		line-height: 1rem;
		font-weight: 500;
	}
	.sb .bdg.me {
		padding: 0 0.375rem;
		background: var(--surface);
		color: var(--text);
		line-height: 1rem;
	}
	.tr {
		text-align: right;
	}
	.val {
		font-size: 1.25rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.ft {
		padding: 0.625rem 1rem;
		border-top: 1px solid var(--line);
		font-size: 0.8rem;
		line-height: 1.2rem;
		color: var(--muted);
	}
	@media (max-width: 899.98px) {
		.row {
			min-height: 48px;
		}
	}
</style>
