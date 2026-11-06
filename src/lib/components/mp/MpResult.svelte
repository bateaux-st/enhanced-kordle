<script lang="ts">
	import type { Snapshot } from '$lib/mp/protocol';
	import { LENGTH_MAX } from '$lib/mp/rules';
	import ClimbPyramid from './ClimbPyramid.svelte';
	import Icon from './Icon.svelte';
	import { statusLabel } from './labels';
	import MpModal from './MpModal.svelte';

	let {
		snap,
		peakCleared = {},
		isHost,
		onclose,
		onleave,
		onagain,
		onnext,
		onwait
	}: {
		snap: Snapshot;
		/** 게임 중 본 사람별 최고 클리어 수. 나간 사람의 높이를 채운다. */
		peakCleared?: Record<string, number>;
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

	const game = $derived(snap.game?.kind === 'comp' ? snap.game : null);
	const coop = $derived(snap.game?.kind === 'coop' ? snap.game : null);
	const climb = $derived(snap.settings.game === 'climb');
	const startN = $derived((game ?? coop)?.startN ?? 0);
	const wordAt = (len: number) => (game ?? coop)?.answers?.[len]?.word;
	const answer = $derived(wordAt(startN));

	const full = $derived(LENGTH_MAX - startN + 1);
	// 결과 시점에 나간 사람은 players에서 지워져 패널이 없다. 높이와 피라미드는 players가 아니라 서버가 확정해 보낸 값에서 구한다:
	// 완주자는 순위표(finishOrder), 그 밖의 도달 높이는 answers의 가장 큰 길이(못 넘은 스테이지)다.
	const solvedAny = $derived((game?.standings ?? []).some((s) => s.finishOrder !== null));
	const stoppedN = $derived(Math.max(startN, ...Object.keys((game ?? coop)?.answers ?? {}).map(Number)));
	const reached = $derived(coop ? coop.cleared : solvedAny ? full : stoppedN - startN);
	const top = $derived(reached >= full);
	// 행별 높이: 완주자는 풀 높이, 그 외는 남아 있는 패널, 나간 사람은 게임 중 본 최고치. 어느 것도 없으면 '-'.
	const heightOf = (pid: string, finished: boolean) =>
		finished ? full : (snap.players.find((p) => p.pid === pid)?.panel?.cleared ?? peakCleared[pid] ?? null);
	// 코스는 모두 같은 단어 순서라 가장 높이 오른 사람까지의 단어가 피라미드가 된다.
	const pyramid = $derived(
		Array.from({ length: reached }, (_, i) => wordAt(startN + i)).filter((w): w is string => w !== undefined)
	);
	// 멈춘 곳의 정답: 협동은 멈춘 스테이지, 경쟁은 가장 높이 오른 사람이 못 넘은 스테이지.
	const stopped = $derived(top || (coop && coop.status === 'won') ? undefined : wordAt(startN + reached));
	const title = $derived(top ? `${LENGTH_MAX}자 완주!` : reached ? `스테이지 ${reached}까지 올랐습니다` : '첫 스테이지에서 멈췄습니다');

	// 상태·시도·정답 순서는 순위표가 확정 시점에 들고 있다. 결과 단계에서 사람이 나가 players에서 사라져도 표는 그대로다.
	const rows = $derived(
		(game?.standings ?? []).map((s) => {
			return {
				pid: s.pid,
				name: s.name,
				me: s.pid === snap.you,
				rank: `${s.tied ? '공동 ' : ''}${s.rank}위`,
				result: s.finishOrder !== null ? `${s.finishOrder}번째 ${climb ? '완주' : '정답'}` : statusLabel(s.status, climb),
				height: heightOf(s.pid, s.finishOrder !== null),
				tries: s.tries
			};
		})
	);
</script>

<MpModal title={climb ? '등반 결과' : '결과'} {onclose}>
	{#if coop && climb}
		<!-- 협동은 순위가 없다. 전원이 같은 결과를 받는다. -->
		<div class="coop-res">
			<p class="big climb-head">{title}</p>
			<ClimbPyramid words={pyramid} />
			{#if stopped}<p class="stopped">멈춘 곳의 정답: <b>{stopped}</b></p>{/if}
			{#if coop.endReason === 'timeout'}<p class="note">시간이 다 됐습니다.</p>{/if}
		</div>
	{:else if coop}
		<div class="coop-res">
			<p class="big">{coop.status === 'won' ? '정답입니다' : answer ? `정답: ${answer}` : '실패했습니다'}</p>
			{#if coop.status === 'won' && answer}<p>정답: <b>{answer}</b></p>{/if}
			<p class="note">{coop.board.rows.length}회 시도</p>
			{#if coop.endReason === 'timeout'}<p class="note">시간이 다 됐습니다.</p>{/if}
		</div>
	{:else}
		{#if answer && !climb}<p class="big">정답: {answer}</p>{/if}
		<div class="table" class:climb role="table" aria-label="순위">
			<div class="trow th" role="row">
				<span role="columnheader">순위</span><span role="columnheader">이름</span><span role="columnheader">결과</span>
				{#if climb}<span role="columnheader" class="tr">높이</span>{/if}
				<span role="columnheader" class="tr">시도</span>
			</div>
			{#each rows as x, i (x.pid)}
				<div class="trow" class:mine={x.me} role="row" style="animation-delay:{Math.min(i, 5) * 90}ms">
					<span class="rk" role="cell">{#if i === 0}<span class="first">{x.rank}</span>{:else}{x.rank}{/if}</span>
					<span class="nm" role="cell">{x.name}{#if x.me}<span class="bdg me">나</span>{/if}</span>
					<span class="res" role="cell"><b>{x.result}</b></span>
					{#if climb}<span class="tr" role="cell">{x.height ?? '-'}</span>{/if}
					<span class="tr" role="cell">{x.tries}</span>
				</div>
			{/each}
		</div>
		{#if climb}
			<div class="comp-climb">
				<ClimbPyramid words={pyramid} />
				{#if stopped}<p class="stopped">멈춘 곳의 정답: <b>{stopped}</b></p>{/if}
			</div>
		{/if}
	{/if}
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
	.coop-res {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.coop-res .big {
		margin-bottom: 0;
	}
	.climb-head {
		text-align: center;
		margin-bottom: 0.5rem;
	}
	.coop-res .stopped,
	.comp-climb .stopped {
		margin-top: 0.75rem;
		text-align: center;
	}
	.comp-climb {
		margin-top: 1rem;
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
	.table.climb .trow {
		grid-template-columns: 4rem minmax(0, 1.4fr) minmax(0, 1.2fr) 2.25rem 2.25rem;
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
		.table.climb .trow {
			grid-template-columns: 4.25rem minmax(0, 1.2fr) minmax(0, 1.1fr) 2rem 2rem;
		}
	}
</style>
