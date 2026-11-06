<script lang="ts">
	import type { PlayerView } from '$lib/mp/protocol';
	import { STATUS_LABEL } from '$lib/mp/rules';
	import Icon from './Icon.svelte';

	let {
		player,
		tries,
		rank = null,
		canKick = false,
		compact = false,
		coop = null,
		onkick
	}: {
		player: PlayerView;
		/** 시도 횟수. 제출 전 행도 빈 칸으로 그린다. */
		tries: number;
		/** 완료한 상대의 순위. 아직 모르면 null. */
		rank?: number | null;
		/** 방장 화면에서 끊긴 상대에게 "탈락 처리"를 보인다. */
		canKick?: boolean;
		/** 모바일 한 줄 띠용 축소 카드. */
		compact?: boolean;
		/** 협동 표시. 있으면 미니 격자 대신 그 사람의 단어(실시간 초안, 없으면 확정 제안)를 보인다. */
		coop?: { state: 'playing' | 'proposed' | 'off' | 'idle'; word: string; confirmed: boolean; n: number } | null;
		onkick?: () => void;
	} = $props();

	const panel = $derived(player.panel);
	const kind = $derived.by(() => {
		if (coop) return coop.state === 'off' ? 'off' : coop.state === 'proposed' ? 'proposed' : coop.state === 'playing' ? 'playing' : 'idle';
		if (!panel) return 'out';
		if (panel.status === 'solved') return 'done';
		if (panel.status !== 'playing') return 'out';
		return player.connected ? 'playing' : 'off';
	});
	// 끝난 이유(실패·포기·시간 초과·탈락)는 패널을 보는 사람이 알아야 하므로 하나로 뭉치지 않는다.
	const label = $derived(
		kind === 'off'
			? '접속 끊김'
			: kind === 'playing'
				? '풀이 중'
				: kind === 'proposed'
					? '제안함'
					: kind === 'idle'
						? ''
						: kind === 'done'
							? rank
								? `완료 ${rank}위`
								: '완료'
							: STATUS_LABEL[panel?.status ?? 'eliminated']
	);
	const marks = $derived(panel?.marks ?? []);
	const n = $derived(coop?.n ?? panel?.n ?? 0);
	const word = $derived([...(coop?.word ?? '')]);
	const summary = $derived.by(() => {
		if (coop) return `${player.name}: ${coop.word ? `${coop.confirmed ? '제안' : '입력 중'} ${coop.word}` : '제안 없음'}`;
		const last = marks[marks.length - 1];
		if (!last) return `${player.name}: 제출한 행 없음`;
		const g = last.filter((m) => m === 'c').length;
		const y = last.filter((m) => m === 'p').length;
		return `${player.name}: 제출한 행 ${marks.length}개, 마지막 행 초록 ${g}칸 노랑 ${y}칸`;
	});
</script>

<section class="opp" class:compact class:off={kind === 'off'} class:out={kind === 'out'} class:flash={kind === 'proposed'} aria-label={player.name}>
	<span class="nm">{player.name}</span>
	{#key label}
		{#if label}
			<span class="st a-pop" class:done={kind === 'done'} class:prop={kind === 'proposed'} class:offc={kind === 'off'}>
				{#if kind === 'playing'}<Icon name="edit" />
				{:else if kind === 'proposed'}<Icon name="check" width={3} />
				{:else if kind === 'done'}<Icon name="checkc" />
				{:else if kind === 'out'}<Icon name="xc" />
				{:else}<Icon name="off" />{/if}
				{label}
			</span>
		{/if}
	{/key}
	{#if coop}
		<!-- 칸은 n개 고정이라 초안이 길어지거나 짧아져도 카드 높이가 변하지 않는다 -->
		<div class="prop-w" role="img" aria-label={summary} style="--n:{n}">
			{#each { length: n } as _, i (i)}
				<span class="pw" class:t={word[i] && !coop.confirmed} class:s={word[i] && coop.confirmed}>{word[i] ?? ''}</span>
			{/each}
		</div>
		<span class="prop-t" class:s={coop.confirmed} aria-hidden="true">{coop.word}</span>
	{:else}
		<div class="mini" role="img" aria-label={summary} style="--n:{n}">
			{#each marks as row, r (r)}
				<div class="r a-fadein">
					{#each row as m, i (i)}<i class="mc k-{m}"></i>{/each}
				</div>
			{/each}
			{#each { length: Math.max(0, tries - marks.length) } as _, r (r)}
				<div class="r">
					{#each { length: n } as _, i (i)}<i class="mc k-e"></i>{/each}
				</div>
			{/each}
		</div>
	{/if}
	{#if canKick && kind === 'off'}
		<button class="btn kick" type="button" onclick={onkick}>탈락 처리<span class="sr"> {player.name}</span></button>
	{/if}
</section>

<style>
	.opp {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		min-width: 0;
		transition:
			opacity var(--mo-fade),
			filter var(--mo-drop);
	}
	.opp.off {
		border: 1px dashed var(--muted);
		opacity: 0.6;
	}
	.opp.out {
		filter: grayscale(1);
	}
	.nm {
		font-size: 1rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.st {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}
	.st.done {
		padding: 0.1875rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--btn-text);
		background: var(--sel-bg);
	}
	.st.offc {
		color: var(--muted);
	}
	.st.prop {
		font-weight: 700;
		color: var(--btn-text);
	}
	.opp.flash {
		animation: mp-lineflash 300ms ease-out both;
	}
	.prop-w {
		--oc: min(24px, calc((13rem - 1.5rem - 2px) / var(--n) - 2px));
		display: flex;
		gap: 2px;
	}
	.pw {
		width: var(--oc);
		height: var(--oc);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--line);
		border-radius: 0.25rem;
		font-size: calc(var(--oc) * 0.5);
		font-weight: 700;
		color: var(--text);
	}
	.pw.t {
		border-color: var(--line-strong);
		background: var(--bg);
		animation: mp-pop var(--mo-pop) ease-out both;
	}
	.pw.s {
		border-color: var(--sel-line);
		background: var(--sel-bg);
	}
	/* 모바일 띠 카드는 칸이 너무 작아 자모를 읽을 수 없어서 글자로 바꿔 보여 준다 */
	.prop-t {
		display: none;
	}
	.mini {
		--oc: min(24px, calc((13rem - 1.5rem - 2px) / var(--n) - 2px));
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.r {
		display: flex;
		gap: 2px;
	}
	.mc {
		width: var(--oc);
		height: var(--oc);
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
	.kick {
		align-self: flex-start;
	}

	/* 모바일 띠: 카드 4개가 한 줄에 들어가도록 칸을 8px로 줄인다 */
	.compact {
		align-items: center;
		max-width: 6.5rem;
		gap: 4px;
		padding: 6px;
		border-radius: 0.375rem;
	}
	.compact .nm {
		max-width: 100%;
		font-size: 0.8125rem;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.compact .mini {
		--oc: min(8px, calc((((100vw - 32px - 24px) / 4) - 14px) / var(--n) - 1px));
		gap: 1px;
	}
	.compact .r {
		gap: 1px;
	}
	.compact .mc {
		border-radius: 1px;
	}
	.compact .st {
		align-self: center;
		font-size: 0.6875rem;
		white-space: nowrap;
	}
	.compact .st.done {
		padding: 0.0625rem 0.25rem;
	}
	.compact .kick {
		padding-inline: 0.5rem;
	}
	.compact .prop-w {
		display: none;
	}
	.compact .prop-t {
		display: block;
		min-height: 2.4em;
		max-width: 100%;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: 0.05em;
		text-align: center;
		overflow-wrap: anywhere;
		color: var(--text);
	}
	.compact .prop-t.s {
		color: var(--btn-text);
	}
</style>
