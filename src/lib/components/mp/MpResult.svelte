<script lang="ts">
	import type { MpClient } from '$lib/mp/client.svelte';
	import type { Snapshot } from '$lib/mp/protocol';
	import { LENGTH_MAX } from '$lib/mp/rules';
	import ClimbPyramid from './ClimbPyramid.svelte';
	import Icon from './Icon.svelte';
	import { statusLabel } from './labels';
	import MpModal from './MpModal.svelte';

	let {
		client,
		snap,
		isHost,
		onclose,
		onleave,
		onagain,
		onnext,
		onwait
	}: {
		/** 채팅 시트를 여는 버튼과 안 읽은 수에만 쓴다. */
		client: MpClient;
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
	// 코스는 모두 같은 단어 순서라 가장 높이 오른 사람까지의 단어가 피라미드가 된다.
	const pyramid = $derived(
		Array.from({ length: reached }, (_, i) => wordAt(startN + i)).filter((w): w is string => w !== undefined)
	);
	// 멈춘 곳의 정답: 협동은 멈춘 스테이지, 경쟁은 가장 높이 오른 사람이 못 넘은 스테이지.
	const stopped = $derived(top || (coop && coop.status === 'won') ? undefined : wordAt(startN + reached));
	const won = $derived(coop?.status === 'won');
	// 협동 결과: 포기한 사람은 가리지 않고, 판에 들어 있던 사람 전원이 같은 결과를 받는다.
	// 서버가 끝난 시점에 확정한 명단을 쓴다. 없는 저장본만 현재 players로 대신한다.
	const people = $derived(
		(coop?.roster ?? snap.players.filter((p) => p.inGame)).map((p) => ({ pid: p.pid, name: p.name, me: p.pid === snap.you }))
	);
	const answerJamo = $derived([...((game ?? coop)?.answers?.[startN]?.jamo ?? '')]);

	// 상태·시도·정답 순서는 순위표가 확정 시점에 들고 있다. 결과 단계에서 사람이 나가 players에서 사라져도 표는 그대로다.
	const rows = $derived(
		(game?.standings ?? []).map((s) => {
			return {
				pid: s.pid,
				name: s.name,
				me: s.pid === snap.you,
				rank: `${s.tied ? '공동 ' : ''}${s.rank}위`,
				solved: s.finishOrder !== null,
				result: s.finishOrder !== null ? `${s.finishOrder}번째 ${climb ? '완주' : '정답'}` : statusLabel(s.status, climb),
				height: s.height,
				tries: s.tries
			};
		})
	);
</script>

{#snippet chatBtn()}
	<button class="btn chat" type="button" aria-label={client.chatUnread ? `채팅, 안 읽은 메시지 ${client.chatUnread}개` : '채팅'} aria-haspopup="dialog" data-chat-entry onclick={(e) => client.openChat(e.currentTarget)}>
		<Icon name="chat" size="1.25rem" />채팅
		{#if client.chatUnread}<span class="cbadge" aria-hidden="true">{client.chatUnread}</span>{/if}
	</button>
{/snippet}

<MpModal title={climb ? '등반 결과' : '결과'} wide={!coop} {onclose}>
	{#if coop}
		<!-- 협동은 순위가 없다. 결과 칩은 경쟁 순위표(A2)와 같은 중립 칩이라 색에만 기대지 않는다 -->
		<div class="coop-res">
			<p class="chip verdict"><i class="dot" class:ok={won} aria-hidden="true"></i>{won ? '성공' : '실패'}</p>
			{#if climb}
				<p class="count"><span class="num">{reached}</span><span class="unit">스테이지 클리어</span></p>
			{:else}
				<p class="count"><span class="num">{coop.board.rows.length}</span><span class="unit">회 시도</span></p>
				<p class="note">시도 횟수 {snap.settings.tries}회</p>
			{/if}
			{#if coop.endReason === 'timeout'}<p class="note">시간이 다 됐습니다.</p>{/if}
			<hr class="sep" />
			{#if climb}
				<ClimbPyramid words={pyramid} />
				{#if stopped}<p class="stopped">멈춘 곳의 정답: <b>{stopped}</b></p>{/if}
			{:else}
				<p class="lbl">정답</p>
				<div class="tiles" class:ok={won} role="img" aria-label="정답 {answer ?? ''} {answerJamo.join('')}">
					{#each answerJamo as ch, i (i)}<span aria-hidden="true">{ch}</span>{/each}
				</div>
				{#if answer}<p class="word">{answer}</p>{/if}
			{/if}
			<hr class="sep" />
			<p class="lbl">함께한 사람 {people.length}명</p>
			<ul class="people">
				{#each people as p (p.pid)}
					<li><span class="nt" title={p.name}>{p.name}</span>{#if p.me}<span class="bdg me">나</span>{/if}</li>
				{/each}
			</ul>
		</div>
	{:else}
		{#if answer && !climb}
			<div class="ans">
				<p class="big">정답: {answer}</p>
				{#if !solvedAny}<p class="note">아무도 맞히지 못했습니다</p>{/if}
			</div>
		{/if}
		<div class="table" class:climb role="table" aria-label="순위">
			<div class="trow th" role="row">
				<span role="columnheader">순위</span><span role="columnheader">이름</span><span role="columnheader">결과</span>
				{#if climb}<span role="columnheader" class="tr">높이</span>{/if}
				<span role="columnheader" class="tr">시도</span>
			</div>
			{#each rows as x, i (x.pid)}
				<div class="trow" class:mine={x.me} role="row" style="animation-delay:{Math.min(i, 5) * 90}ms">
					<span class="rk" role="cell">{#if i === 0 && x.solved}<span class="first">{x.rank}</span>{:else}{x.rank}{/if}</span>
					<span class="nm" role="cell"><span class="nt" title={x.name}>{x.name}</span>{#if x.me}<span class="bdg me">나</span>{/if}</span>
					<span class="res" role="cell"><span class="chip"><i class="dot" class:ok={x.solved} aria-hidden="true"></i>{x.result}</span></span>
					{#if climb}<span class="tr" role="cell">{x.height ?? '-'}</span>{/if}
					<span class="tr" role="cell">{x.tries}회</span>
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
			<div class="two">
				{@render chatBtn()}
				<button class="btn" type="button" onclick={onnext}>설정 바꾸기</button>
				<button class="btn" type="button" onclick={onleave}><Icon name="exit" />나가기</button>
			</div>
		{:else}
			<p class="wait" role="status">방장이 다음 게임을 고르는 중입니다.</p>
			<button class="btn primary big block" type="button" onclick={onwait}>대기실로</button>
			<div class="two">
				{@render chatBtn()}
				<button class="btn" type="button" onclick={onleave}><Icon name="exit" />나가기</button>
			</div>
		{/if}
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
		align-items: center;
		text-align: center;
		padding-top: 0.25rem;
		font-variant-numeric: tabular-nums;
	}
	.coop-res .verdict {
		font-size: 0.875rem;
	}
	.count {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.count .num {
		font-size: 4.5rem;
		line-height: 1;
		font-weight: 700;
	}
	.count .unit {
		font-size: 1.125rem;
		font-weight: 700;
	}
	.coop-res .note {
		margin-top: 0.5rem;
	}
	.sep {
		width: 100%;
		height: 1px;
		margin: 1.25rem 0 1rem;
		border: 0;
		background: var(--line);
	}
	.lbl {
		margin-bottom: 0.5rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	/* 정답 칸은 맞힌 판이면 초록, 놓친 판이면 중립 회색. 글자색은 칸 색에서 4.5:1을 지키는 쪽을 고른다 */
	.tiles {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px;
	}
	.tiles span {
		width: 2.5rem;
		height: 2.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		font-size: 1.25rem;
		font-weight: 700;
		background: var(--key);
		color: var(--on-key);
	}
	.tiles.ok span {
		background: var(--tile-correct);
		color: var(--text);
	}
	:global(:root[data-theme='dark']) .tiles.ok span {
		color: var(--on-tile);
	}
	.word {
		margin-top: 0.5rem;
		font-size: 1rem;
		font-weight: 700;
	}
	.people {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		max-width: 100%;
	}
	.people li {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 100%;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--muted);
		border-radius: 0.25rem;
		background: var(--surface);
		font-size: 0.9rem;
		font-weight: 700;
	}
	.people .bdg.me {
		flex: none;
		background: var(--surface);
		color: var(--text);
	}
	.coop-res .stopped,
	.comp-climb .stopped {
		margin-top: 0.75rem;
		text-align: center;
	}
	.comp-climb {
		margin-top: 1rem;
	}
	.ans {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		margin-bottom: 0.75rem;
	}
	.ans .big {
		margin-bottom: 0;
	}
	.table {
		border: 1px solid var(--line);
		border-radius: 0.375rem;
		overflow: hidden;
	}
	.trow {
		display: grid;
		grid-template-columns: 4.5rem minmax(14rem, 1fr) 6.75rem 3rem;
		column-gap: 0.5rem;
		align-items: center;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--line);
		animation: mp-drop var(--mo-drop) ease-out both;
	}
	.table.climb .trow {
		grid-template-columns: 4.5rem minmax(11rem, 1fr) 6.75rem 2.25rem 3rem;
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
		font-size: 0.9rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.first {
		display: inline-block;
		font-size: 1.125rem;
		animation: mp-pop var(--mo-pop) ease-out 0.2s both;
	}
	.nm {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-weight: 700;
		min-width: 0;
	}
	/* 이름은 한 줄을 지키고 넘치면 말줄임. 나 배지는 줄어들지 않는다 */
	.nt {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nm .bdg.me {
		flex: none;
		background: var(--surface);
		color: var(--text);
	}
	/* 결과는 색에만 기대지 않는다. 정답은 초록 점, 그 밖은 속이 빈 회색 고리, 글자가 뜻을 말한다 */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--muted);
		border-radius: 0.25rem;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text);
		white-space: nowrap;
	}
	.dot {
		flex: none;
		width: 0.625rem;
		height: 0.625rem;
		box-sizing: border-box;
		border: 1px solid var(--muted);
		border-radius: 50%;
	}
	.dot.ok {
		border: 0;
		background: var(--tile-correct);
	}
	.tr {
		text-align: right;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.trow.th .tr {
		font-size: 0.75rem;
	}
	.dlg-act {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
	.two {
		display: flex;
		gap: 0.5rem;
	}
	.two .btn {
		flex: 1;
	}
	.wait {
		text-align: center;
		color: var(--muted);
	}
	@media (max-width: 899.98px) {
		.trow {
			grid-template-columns: 3.75rem minmax(0, 1fr) auto 2.25rem;
			column-gap: 0.375rem;
			padding-inline: 0.5rem;
		}
		.table.climb .trow {
			grid-template-columns: 3.75rem minmax(0, 1fr) auto 1.75rem 2.25rem;
		}
		.chip {
			gap: 0.375rem;
			padding: 0.25rem 0.5rem;
			font-size: 0.75rem;
		}
	}
</style>
