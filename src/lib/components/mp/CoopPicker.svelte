<script module lang="ts">
	/** 투표 후보 한 줄. 득표수는 투표 중에도 공개한다. */
	export interface VoteCand {
		jamo: string;
		names: string[];
		mine: boolean;
		count: number;
		picked: boolean;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		vote = null,
		wheel = null
	}: {
		vote?: { cands: VoteCand[]; k: number; m: number; isHost: boolean; onvote: (i: number) => void; onclose: () => void } | null;
		wheel?: {
			cands: { jamo: string; names: string[] }[];
			chosen: number;
			/** 첫 회전 전 대기(ms). 동률 토스트를 읽을 시간. */
			delay: number;
			reduced: boolean;
			ondone: () => void;
		} | null;
	} = $props();

	// 간격이 늘어나며 감속하는 이동 간격(MULTIPLAYER_MOTION §5). 합 1590ms를 WHEEL_MS로 맞춘다.
	const STEPS = [60, 60, 70, 80, 100, 130, 170, 220, 300, 400];
	const WHEEL_MS = 1500;
	// 멈춘 뒤 결과를 읽을 시간. 이 뒤에야 보드에 행이 들어간다.
	const SETTLE_MS = 700;

	let pos = $state(-1);
	let done = $state(false);

	// 서버가 이미 정한 chosen에서 끝나도록 거꾸로 센다. 세 화면이 같은 단어에서 멈추는 근거다.
	onMount(() => {
		if (!wheel) return;
		const { cands, chosen, delay, reduced, ondone } = wheel;
		const m = cands.length;
		const timers: ReturnType<typeof setTimeout>[] = [];
		if (reduced) {
			pos = chosen;
			done = true;
			timers.push(setTimeout(ondone, SETTLE_MS));
		} else {
			const scale = WHEEL_MS / STEPS.reduce((a, b) => a + b, 0);
			let t = delay;
			STEPS.forEach((ms, i) => {
				timers.push(
					setTimeout(() => {
						pos = (((chosen - (STEPS.length - 1 - i)) % m) + m) % m;
						if (i === STEPS.length - 1) done = true;
					}, t)
				);
				t += ms * scale;
			});
			timers.push(setTimeout(ondone, t + SETTLE_MS));
		}
		return () => timers.forEach(clearTimeout);
	});

	const resultText = $derived(wheel && done ? (wheel.reduced ? `돌림판 결과: ${wheel.cands[pos].jamo}` : `${wheel.cands[pos].jamo}(으)로 정했습니다`) : '');
</script>

{#snippet tiles(jamo: string)}
	<div class="tiles" role="img" aria-label={jamo} style="--n:{[...jamo].length}">
		{#each [...jamo] as j, i (i)}<span>{j}</span>{/each}
	</div>
{/snippet}

{#if vote}
	<section class="sel" aria-labelledby="sel-vote">
		<div class="hd">
			<h2 id="sel-vote">투표</h2>
			<span class="prog" role="status">투표 {vote.k}/{vote.m}</span>
		</div>
		<ul class="cands">
			{#each vote.cands as c, i (c.jamo)}
				<li class="cand" class:picked={c.picked}>
					<div class="top">
						{@render tiles(c.jamo)}
						<span class="cnt">{c.count}표</span>
					</div>
					<div class="vbar" aria-hidden="true"><i style="width:{vote.m ? Math.round((c.count / vote.m) * 100) : 0}%"></i></div>
					<div class="bot">
						<span class="who">{c.names.join(' · ')}</span>
						{#if c.mine}
							<button class="btn" type="button" disabled>내 제안<span class="sr"> {c.jamo}</span></button>
						{:else}
							<button class="btn" type="button" aria-pressed={c.picked} onclick={() => vote.onvote(i)}>
								{#if c.picked}<Icon name="check" width={3} size="0.875rem" />{/if}투표<span class="sr"> {c.jamo}</span>
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if vote.isHost}
			<div class="foot"><button class="btn primary" type="button" onclick={vote.onclose}>마감</button></div>
		{/if}
	</section>
{:else if wheel}
	<section class="sel" aria-labelledby="sel-wheel">
		<div class="hd"><h2 id="sel-wheel">돌림판</h2></div>
		<ul class="cands">
			{#each wheel.cands as c, i (c.jamo)}
				<li class="cand" class:hot={i === pos} class:fin={i === pos && done}>
					<div class="top">{@render tiles(c.jamo)}</div>
					<div class="bot"><span class="who">{c.names.join(' · ')}</span></div>
				</li>
			{/each}
		</ul>
		<p class="res" role="status">{resultText}</p>
	</section>
{/if}

<style>
	.sel {
		width: min(26rem, 100%);
		padding: 1rem 1.25rem 1.25rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: var(--shadow);
		animation: mp-drop var(--mo-drop) ease-out both;
	}
	.hd {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h2 {
		font-size: 1.125rem;
		font-weight: 700;
	}
	.prog {
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}
	.cands {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.cand {
		padding: 0.75rem;
		border: 2px solid var(--line);
		border-radius: 0.5rem;
		transition:
			background-color var(--mo-pop) ease-out,
			border-color var(--mo-pop);
	}
	.cand.hot,
	.cand.picked {
		border-color: var(--sel-line);
		background: var(--sel-bg);
	}
	.cand.fin {
		animation: mp-pop var(--mo-pop) ease-out both;
	}
	.top,
	.bot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.bot {
		margin-top: 0.75rem;
		font-size: 0.875rem;
	}
	.who {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.tiles {
		--t: clamp(20px, calc((min(26rem, 100vw - 2rem) - 8rem) / var(--n) - 3px), 32px);
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		min-width: 0;
	}
	.tiles span {
		width: var(--t);
		height: var(--t);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--line-strong);
		border-radius: 0.25rem;
		background: var(--bg);
		font-size: calc(var(--t) * 0.5);
		font-weight: 700;
	}
	.cnt {
		flex: none;
		font-size: 1.125rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.vbar {
		height: 4px;
		margin-top: 0.5rem;
		border-radius: 2px;
		background: var(--line);
		overflow: hidden;
	}
	.vbar i {
		display: block;
		height: 100%;
		background: var(--muted);
		transition: width var(--mo-drop) ease-out;
	}
	.res {
		min-height: 1.5rem;
		margin-top: 1.25rem;
		font-size: 1rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		margin-top: 1.25rem;
	}
</style>
