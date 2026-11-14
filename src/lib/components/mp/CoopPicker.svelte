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
	import { onMount, untrack } from 'svelte';
	import { VOTE_MS } from '$lib/mp/rules';
	import Icon from './Icon.svelte';
	import { stack } from './modalStack';
	import { mpPrefs } from './prefs.svelte';
	import { toastState } from './toast.svelte';

	let {
		vote = null,
		wheel = null
	}: {
		vote?: {
			cands: VoteCand[];
			k: number;
			m: number;
			isHost: boolean;
			/** 서버 시계 기준 마감(ms). 마감 필드가 생기기 전의 저장본이면 null이고 시간 행을 그리지 않는다. */
			deadline: number | null;
			/** 서버 시계로 보정한 지금(ms). */
			now: () => number;
			onvote: (i: number) => void;
			onclose: () => void;
			/** 안 읽은 채팅 수와 채팅 시트를 여는 함수. 투표 시트가 머리 버튼을 덮으므로 시트 안에 진입점을 둔다. */
			unread?: number;
			onchat?: (from: HTMLElement) => void;
		} | null;
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
	// 이 초 이하부터는 색 외에 아이콘·테두리·글자로도 마감이 가깝다고 알린다.
	const URGENT_SEC = 5;

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

	const resultText = $derived(wheel && done ? (wheel.reduced ? `돌림판 결과: ${wheel.cands[pos].jamo}` : `정한 단어: ${wheel.cands[pos].jamo}`) : '');

	// ---- 투표 시트 ----
	let sheet = $state<HTMLElement>();
	let list = $state<HTMLElement>();
	const me = Symbol();

	const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

	// 모달이라 시트 안에서만 Tab이 돈다. 닫을 수 있는 화면이 아니므로 Esc는 받지 않는다(투표를 건너뛰는 길이 되지 않게).
	// 확인 대화상자나 재촉 레이어, 채팅 시트가 위에 뜨면 그쪽이 키를 받는다.
	onMount(() => {
		const el = sheet;
		if (!vote || !el) return;
		// 투표는 맨 아래 층이다. 채팅이 먼저 열려 있었다면 그 위로 올라서지 않고, 쓰던 입력칸의 포커스도 뺏지 않는다.
		const covered = stack.length > 0;
		stack.unshift(me);
		if (!covered) (el.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el.querySelector<HTMLElement>('.cands button'))?.focus();

		function onkeydown(e: KeyboardEvent) {
			if (e.key !== 'Tab' || stack[stack.length - 1] !== me || !el) return;
			const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (!f.length) return e.preventDefault();
			const first = f[0];
			const last = f[f.length - 1];
			if (!el.contains(document.activeElement)) {
				e.preventDefault();
				first.focus();
			} else if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
		window.addEventListener('keydown', onkeydown, true);
		return () => {
			window.removeEventListener('keydown', onkeydown, true);
			stack.splice(stack.indexOf(me), 1);
		};
	});

	// 남은 시간. 서버가 정하고 여기 시계는 보여 줄 뿐이다.
	const deadline = $derived(vote?.deadline ?? null);
	let now = $state(untrack(() => vote?.now() ?? 0));
	$effect(() => {
		if (deadline === null) return;
		const clock = untrack(() => vote?.now);
		if (!clock) return;
		now = clock();
		const id = setInterval(() => (now = clock()), 250);
		return () => clearInterval(id);
	});
	const leftMs = $derived(deadline === null ? 0 : Math.max(0, deadline - now));
	const secs = $derived(Math.ceil(leftMs / 1000));
	const urgent = $derived(deadline !== null && secs <= URGENT_SEC);
	// 움직임 줄이기에서는 막대가 부드럽게 줄지 않고 1초씩 끊어 줄어든다.
	const fill = $derived(Math.min(100, ((mpPrefs.reduced ? secs * 1000 : leftMs) * 100) / VOTE_MS));

	// 스크린 리더에는 시트 안의 status 하나만 문구를 갈아 끼운다. 매초 읽지 않고 표 수가 바뀔 때와 10초·5초에만 알린다.
	const k = $derived(vote?.k ?? 0);
	const m = $derived(vote?.m ?? 0);
	let said = $state('');
	$effect(() => {
		said = `투표 ${k}/${m}명`;
	});
	let prevSecs = untrack(() => secs);
	$effect(() => {
		const s = secs;
		const crossed = [10, URGENT_SEC].find((x) => s <= x && prevSecs > x);
		prevSecs = s;
		if (crossed) said = `${crossed}초 남았습니다`;
	});

	// 고른 카드가 목록 밖으로 밀려나지 않게 한다. 후보가 늘어도 목록 위치는 그대로 둔다.
	const pickedIdx = $derived(vote?.cands.findIndex((c) => c.picked) ?? -1);
	$effect(() => {
		void pickedIdx;
		list?.querySelector('.picked')?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#snippet tiles(jamo: string, cls = '')}
	<div class="tiles {cls}" role="img" aria-label={jamo} style="--n:{[...jamo].length}">
		{#each [...jamo] as j, i (i)}<span>{j}</span>{/each}
	</div>
{/snippet}

{#if vote}
	<!-- 힌트 투표 막대가 열려 있으면 --vi가 그 아래 가장자리라 시트가 막대를 덮지 않는다 -->
	<div class="scrim" style:--vi={toastState.top === null ? null : `${toastState.top}px`}>
		<div bind:this={sheet} class="sheet" role="dialog" aria-modal="true" aria-labelledby="sel-vote">
			<div class="top">
				<div class="th">
					<h2 id="sel-vote">투표</h2>
					{#if vote.onchat}
						{@const unread = vote.unread ?? 0}
						<button class="btn chat" type="button" aria-label={unread ? `채팅, 안 읽은 메시지 ${unread}개` : '채팅'} aria-haspopup="dialog" data-chat-entry onclick={(e) => vote.onchat?.(e.currentTarget)}>
							<Icon name="chat" size="1.25rem" />채팅
							{#if unread}<span class="cbadge" aria-hidden="true">{unread}</span>{/if}
						</button>
					{/if}
				</div>
				<div class="vstat">
					<div class="r1">
						<span class="vc">투표 {vote.k}/{vote.m}명</span>
						<span class="vp">
							<span class="pips" role="img" aria-label="{vote.m}명 중 {vote.k}명 투표">
								{#each { length: vote.m } as _, i (i)}<i class:e={i >= vote.k}></i>{/each}
							</span>
							<span class="left">{Math.max(0, vote.m - vote.k)}명 남음</span>
						</span>
					</div>
					{#if deadline !== null}
						<div class="vtime" class:urgent role="timer" aria-live="off" aria-label="남은 시간 {secs}초">
							<Icon name={urgent ? 'alert' : 'clock'} size="1.25rem" />
							<span class="n">{secs}<small>초</small></span>
							<span class="trk" aria-hidden="true"><i style="width:{fill}%"></i></span>
							{#if urgent}<span class="soon">곧 마감</span>{/if}
						</div>
					{/if}
					<p class="sr" role="status">{said}</p>
					<p class="anon">누가 어디에 투표했는지는 보이지 않습니다.</p>
				</div>
			</div>

			<ul class="cands" bind:this={list}>
				{#each vote.cands as c, i (c.jamo)}
					<li class="cand" class:picked={c.picked}>
						<div class="ctop">
							{@render tiles(c.jamo)}
							<span class="cnt">{c.count}표</span>
						</div>
						<div class="meter" aria-hidden="true"><i style="width:{vote.m ? Math.round((c.count / vote.m) * 100) : 0}%"></i></div>
						<div class="cbot">
							<span class="who">{c.names.join(' · ')}{#if c.mine}<span class="bdg me">내 제안</span>{/if}</span>
							<button class="btn pick" type="button" aria-pressed={c.picked} onclick={() => vote.onvote(i)}>
								{#if c.picked}<Icon name="check" width={3} size="0.875rem" />{/if}{c.picked ? '선택함' : '선택하기'}<span class="sr"> {c.jamo}</span>
							</button>
						</div>
					</li>
				{/each}
			</ul>

			<div class="foot">
				<p class="note">표는 마감 전까지 바꿀 수 있습니다. {deadline !== null ? '시간이 끝나면 그때까지의 표로 정하고, ' : ''}동률이면 돌림판입니다.</p>
				{#if vote.isHost}
					<button class="btn primary" type="button" onclick={vote.onclose}>투표 마감</button>
				{/if}
			</div>
		</div>
	</div>
{:else if wheel}
	<section class="sel" aria-labelledby="sel-wheel">
		<div class="hd"><h2 id="sel-wheel">돌림판</h2></div>
		<ul class="wcands">
			{#each wheel.cands as c, i (c.jamo)}
				<li class="cand" class:hot={i === pos} class:fin={i === pos && done}>
					<div class="ctop">{@render tiles(c.jamo, 'w')}</div>
					<div class="cbot"><span class="who">{c.names.join(' · ')}</span></div>
				</li>
			{/each}
		</ul>
		<p class="res" role="status">{resultText}</p>
	</section>
{/if}

<style>
	/* ---- 돌림판 카드 ---- */
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
	.wcands {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.cand.hot {
		border-color: var(--sel-line);
		background: var(--sel-bg);
	}
	.cand.fin {
		animation: mp-pop var(--mo-pop) ease-out both;
	}
	.sel .cbot {
		margin-top: 0.75rem;
	}
	.tiles.w {
		--t: clamp(20px, calc((min(26rem, 100vw - 2rem) - 8rem) / var(--n) - 3px), 32px);
	}
	.res {
		min-height: 1.5rem;
		margin-top: 1.25rem;
		font-size: 1rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	/* ---- 후보 카드(돌림판·투표 공통) ---- */
	.cand {
		padding: 0.75rem;
		border: 2px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		transition:
			background-color var(--mo-pop) ease-out,
			border-color var(--mo-pop);
	}
	.cand.picked {
		border-color: var(--sel-line);
		background: var(--sel-bg);
	}
	.ctop,
	.cbot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.cbot {
		font-size: 0.875rem;
	}
	.who {
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		overflow-wrap: anywhere;
	}
	.tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		min-width: 0;
	}
	.tiles span {
		width: var(--t, 32px);
		height: var(--t, 32px);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--line-strong);
		border-radius: 0.25rem;
		background: var(--bg);
		font-size: calc(var(--t, 32px) * 0.5);
		font-weight: 700;
	}
	.cnt {
		flex: none;
		font-size: 1.125rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	/* ---- 투표 시트: 데스크톱은 오른쪽, 640px 미만은 아래에서 올라온다 ---- */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: 1rem;
		background: var(--scrim);
		animation: mp-fadein var(--mo-fade) ease-out both;
	}
	.sheet {
		width: 24rem;
		max-width: 100%;
		max-height: calc(100vh - 2rem);
		max-height: calc(100dvh - 2rem);
		display: flex;
		flex-direction: column;
		padding: 1rem 1.25rem 1.25rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		box-shadow: var(--shadow);
		font-variant-numeric: tabular-nums;
		/* 문구가 음절 사이에서 꺾이지 않게 한다(이름은 .who의 overflow-wrap이 긴 경우만 끊는다) */
		word-break: keep-all;
		animation: mp-drop var(--mo-drop) ease-out both;
	}
	.top {
		flex: none;
	}
	.th {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.top h2 {
		line-height: 1.75rem;
	}
	.vstat {
		padding: 0.625rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--sel-bg);
	}
	.r1 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.vc {
		font-size: 1rem;
		font-weight: 700;
		color: var(--btn-text);
	}
	.vp {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.pips {
		display: flex;
		gap: 4px;
	}
	.pips i {
		width: 18px;
		height: 8px;
		border-radius: 2px;
		background: var(--btn-primary);
	}
	.pips i.e {
		background: var(--bg);
		border: 1px solid var(--sel-line);
	}
	.left {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--btn-text);
	}
	.vtime {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.625rem;
		color: var(--btn-text);
	}
	.vtime .n {
		flex: none;
		display: inline-flex;
		align-items: baseline;
		justify-content: center;
		gap: 2px;
		min-width: 3.75rem;
		/* 마지막 5초에 테두리가 생겨도 숫자가 밀리지 않게 처음부터 자리를 둔다 */
		padding: 0 0.5rem;
		border: 2px solid transparent;
		border-radius: 0.375rem;
		font-size: 1.5rem;
		line-height: 1.75rem;
		font-weight: 700;
		color: var(--text);
	}
	.vtime .n small {
		font-size: 0.875rem;
	}
	.trk {
		flex: 1 1 auto;
		min-width: 0;
		height: 8px;
		border: 1px solid var(--sel-line);
		border-radius: 4px;
		background: var(--bg);
		overflow: hidden;
	}
	.trk i {
		display: block;
		height: 100%;
		background: var(--btn-primary);
		transition: width 0.25s linear;
	}
	.soon {
		flex: none;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text);
	}
	.vtime.urgent {
		color: var(--text);
	}
	.vtime.urgent .n {
		border-color: var(--on-danger);
	}
	.vtime.urgent .trk {
		border-color: var(--on-danger);
	}
	.vtime.urgent .trk i {
		background: var(--danger);
		box-shadow: inset 0 0 0 1px var(--on-danger);
	}
	.anon {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		line-height: 1.25rem;
		color: var(--text);
	}

	.cands {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0.75rem -4px 0;
		padding: 4px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.cands .cand {
		flex: none;
	}
	.cands .tiles {
		--t: clamp(20px, calc((min(24rem, 100vw) - 11rem) / var(--n) - 3px), 32px);
	}
	.meter {
		height: 4px;
		margin-top: 0.5rem;
		border-radius: 2px;
		background: var(--line);
		overflow: hidden;
	}
	.meter i {
		display: block;
		height: 100%;
		background: var(--muted);
		transition: width var(--mo-drop) ease-out;
	}
	.cands .cbot {
		margin-top: 0.5rem;
	}
	.pick {
		flex: none;
		min-width: 5.5rem;
		font-size: 0.875rem;
		font-weight: 700;
	}
	/* 전역 .btn:hover(0,4,0)가 aria-pressed 배경(0,3,0)을 이겨 선택함이 연해지므로 같은 무게로 되돌린다 */
	.pick[aria-pressed='true']:hover:not(:disabled) {
		background: var(--btn-primary-hover);
	}
	.foot {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
	}
	.foot .note {
		line-height: 1.4;
	}
	.foot .btn {
		flex: none;
		min-width: 5.5rem;
		font-size: 0.875rem;
		font-weight: 700;
	}

	/* 힌트 투표 막대(가운데, 28rem)와 시트가 가로로 겹치는 폭에서는 시트를 막대 아래로 내린다 */
	@media (min-width: 640px) and (max-width: 1247.98px) {
		.scrim {
			padding-top: var(--vi, 1rem);
		}
		.sheet {
			max-height: calc(100vh - var(--vi, 1rem) - 1rem);
			max-height: calc(100dvh - var(--vi, 1rem) - 1rem);
		}
	}

	@media (max-width: 639.98px) {
		.scrim {
			align-items: flex-end;
			padding: 0;
		}
		.sheet {
			width: 100%;
			max-height: min(72vh, calc(100vh - var(--vi, 3rem)));
			max-height: min(72dvh, calc(100dvh - var(--vi, 3rem)));
			padding: 1rem 1rem max(1rem, env(safe-area-inset-bottom, 0px));
			border-width: 1px 0 0;
			border-radius: 0.75rem 0.75rem 0 0;
		}
		/* 머리 한 줄(제목 + 몇 명 투표)과 시간 한 줄만 남기고 요약 박스는 푼다 */
		.top {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 0.5rem 0.75rem;
		}
		.top h2 {
			margin: 0;
		}
		.vstat,
		.r1 {
			display: contents;
		}
		.vstat {
			padding: 0;
		}
		.vc {
			color: var(--text);
			font-size: 0.875rem;
		}
		.vp {
			display: none;
		}
		.vtime {
			grid-column: 1 / -1;
			margin: 0;
		}
		.anon {
			grid-column: 1 / -1;
			margin: 0;
		}
		.cands {
			gap: 0.625rem;
			margin-top: 0.5rem;
		}
		.cands .cand {
			padding: 0.5rem 0.75rem;
		}
		.meter {
			display: none;
		}
		.cands .cbot {
			margin-top: 0.25rem;
		}
		.foot {
			flex-direction: column;
			align-items: stretch;
			gap: 0.75rem;
			margin-top: 0.75rem;
		}
		.foot .btn {
			width: 100%;
		}
	}
</style>
