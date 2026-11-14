<script lang="ts">
	import type { PlayerView } from '$lib/mp/protocol';
	import Icon from './Icon.svelte';
	import { oppKind, oppLabel } from './labels';

	let {
		player,
		tries,
		rank = null,
		climb = false,
		expanded = false,
		controls,
		onclick
	}: {
		player: PlayerView;
		tries: number;
		/** 완료한 상대의 순위. 아직 모르면 null. */
		rank?: number | null;
		climb?: boolean;
		expanded?: boolean;
		/** 펼쳐졌을 때 이 칩이 가리키는 격자 영역의 id. */
		controls: string;
		onclick: () => void;
	} = $props();

	const panel = $derived(player.panel);
	const kind = $derived(oppKind(player));
	const label = $derived(oppLabel(player, kind, rank, climb));
	const n = $derived(panel?.n ?? 0);
	const last = $derived(panel?.marks[panel.marks.length - 1] ?? []);
	const used = $derived(panel?.marks.length ?? 0);
	// 등반은 스테이지가 가장 큰 정보라 시도 수 자리에 스테이지를 적는다.
	const meta = $derived(climb && panel ? `스테이지 ${panel.stage}` : `${used}/${tries}`);
	const summary = $derived(
		`${player.name}, ${label}, ${climb && panel ? `스테이지 ${panel.stage}, ` : ''}시도 ${used}/${tries}. 격자 크게 보기`
	);
</script>

<button
	class="oc"
	data-pid={player.pid}
	class:open={expanded}
	class:off={kind === 'off'}
	class:out={kind === 'out'}
	type="button"
	aria-expanded={expanded}
	aria-controls={expanded ? controls : undefined}
	aria-label={summary}
	{onclick}
>
	<span class="l">
		<span class="nm">{player.name}</span>
		<span class="st" class:done={kind === 'done'} class:offc={kind === 'off'} class:outc={kind === 'out'}>
			{#if kind === 'playing'}<Icon name="edit" />
			{:else if kind === 'done'}<Icon name="checkc" />
			{:else if kind === 'out'}<Icon name={player.left ? 'exit' : 'xc'} />
			{:else}<Icon name="off" />{/if}
			{label}
		</span>
	</span>
	<span class="r" aria-hidden="true">
		<span class="dots" style="--n:{n || 6}">
			{#each { length: n } as _, i (i)}<i class="d k-{last[i] ?? 'e'}"></i>{/each}
		</span>
		<span class="meta">{meta}</span>
	</span>
</button>

<style>
	.oc {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-width: 0;
		height: 44px;
		padding: 0 0.5rem;
		border: 1px solid var(--muted);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.oc.open {
		border-color: var(--sel-line);
		background: var(--sel-bg);
	}
	/* 끊긴 칩만 점선 테두리. 격자만 흐리게 하고 이름·칩·테두리는 선명하게 둔다. 이름은 펼친 칩의 --sel-bg 위에서 흐리면 4.5:1이 안 나온다 */
	.oc.off {
		border-style: dashed;
	}
	.l {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
	}
	.nm {
		max-width: 100%;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.st {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.2;
		white-space: nowrap;
	}
	.st :global(.ic) {
		width: 0.75rem;
		height: 0.75rem;
	}
	.st.done {
		padding: 0 5px;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--btn-text);
		background: var(--sel-bg);
	}
	.st.outc,
	.st.offc {
		padding: 0 5px;
		border: 1px solid var(--muted);
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		font-weight: 700;
	}
	.st.offc {
		border-style: dashed;
		color: var(--muted);
	}
	/* 펼친 칩의 배경(--sel-bg) 위에서 --muted는 4.5:1이 안 나온다 */
	.oc.open .st.offc {
		color: var(--text);
	}
	.st.outc :global(.ic),
	.st.offc :global(.ic),
	.st.done :global(.ic) {
		width: 0.6875rem;
		height: 0.6875rem;
	}
	.r {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
	}
	/* 칸 크기는 9px, 12자에서도 격자가 4.75rem을 넘지 않게 줄여 이름 자리를 남긴다. 전체 격자는 탭해서 연 시트에 있다 */
	.dots {
		--d: min(9px, calc(4.75rem / var(--n) - 2px));
		display: flex;
		gap: 2px;
		transition: opacity var(--mo-fade);
	}
	.d {
		display: block;
		width: var(--d);
		height: var(--d);
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
	.meta {
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.out .dots {
		opacity: 0.7;
	}
	.off .dots {
		opacity: 0.6;
	}
</style>
