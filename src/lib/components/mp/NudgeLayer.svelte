<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Icon from './Icon.svelte';
	import { playNudgeTone, vibrate } from './nudgeFx';
	import { stack } from './modalStack';
	import { mpPrefs } from './prefs.svelte';

	let {
		names,
		count,
		total,
		ready,
		replay,
		canStart,
		screen,
		onstart,
		onclose
	}: {
		/** 재촉한 사람들. 둘 이상이면 "○○님 외 n명"으로 줄인다. */
		names: string[];
		/** 받은 재촉 횟수(같은 사람이 여러 번 보낸 것도 센다). */
		count: number;
		/** 지금 접속 중인 방장 외 인원과 그중 준비한 인원. 전원이 준비하면 시작할 수 있다. */
		total: number;
		ready: number;
		/** 값이 바뀌면 새 재촉이 온 것이다(연출을 다시 재생). */
		replay: number;
		canStart: boolean;
		/** 흔들고 흐릴 뒤 화면. */
		screen: HTMLElement | undefined;
		onstart: () => void;
		onclose: () => void;
	} = $props();

	const REPLAY_MS = 4000;
	const id = $props.id();
	const me = Symbol();
	const message = $derived(names.length > 1 ? `${names[0]}님 외 ${names.length - 1}명이 재촉합니다!` : `${names[0]}님이 재촉합니다!`);
	const reduced = $derived(mpPrefs.reduced);
	const startLabel = $derived(canStart ? '지금 시작' : '대기실 보기');

	let layer: HTMLElement | undefined = $state();
	let box: HTMLElement | undefined = $state();
	let flashEl: HTMLElement | undefined = $state();

	/** 흔들림(±12px 500ms) + 전체 플래시 3회 + 소리 + 진동. 움직임 줄이기에서는 소리와 진동만. */
	function play() {
		if (!mpPrefs.reduced) {
			const shake = [
				{ transform: 'translateX(0)' },
				{ transform: 'translateX(-4px)', offset: 0.1 },
				{ transform: 'translateX(12px)', offset: 0.2 },
				{ transform: 'translateX(-12px)', offset: 0.3 },
				{ transform: 'translateX(12px)', offset: 0.4 },
				{ transform: 'translateX(-12px)', offset: 0.5 },
				{ transform: 'translateX(12px)', offset: 0.6 },
				{ transform: 'translateX(-12px)', offset: 0.7 },
				{ transform: 'translateX(12px)', offset: 0.8 },
				{ transform: 'translateX(-4px)', offset: 0.9 },
				{ transform: 'translateX(0)' }
			];
			screen?.animate(shake, { duration: 500, easing: 'ease-in-out' });
			box?.animate(shake, { duration: 500, easing: 'ease-in-out' });
			flashEl?.animate([{ opacity: 0 }, { opacity: 0.25 }, { opacity: 0 }], { duration: 300, iterations: 3, easing: 'ease-in-out' });
		}
		playNudgeTone();
		vibrate();
	}

	// 레이어가 뜰 때와 그 뒤 4초마다, 새 재촉이 오면 처음부터 다시.
	$effect(() => {
		void replay;
		untrack(play);
		const t = setInterval(play, REPLAY_MS);
		return () => clearInterval(t);
	});

	// 뒤 화면 흐림. 움직임 줄이기에서는 레이어 대신 상단 배너라 흐리지 않는다.
	$effect(() => {
		if (!screen || reduced) return;
		screen.style.filter = 'blur(2px)';
		return () => (screen.style.filter = '');
	});

	// 탭 제목 "(!) 재촉 - ..." 500ms 깜빡임. 창에 포커스가 돌아오면 제목부터 복원한다.
	onMount(() => {
		const base = document.title;
		const alt = `(!) 재촉 - ${base}`;
		let on = true;
		document.title = alt;
		const blink = setInterval(() => {
			on = !on;
			document.title = on ? alt : base;
		}, 500);
		const restore = () => {
			clearInterval(blink);
			document.title = base;
		};
		window.addEventListener('focus', restore);
		const onvis = () => document.visibilityState === 'visible' && restore();
		document.addEventListener('visibilitychange', onvis);

		const opener = document.activeElement as HTMLElement | null;
		// 움직임 줄이기의 배너는 비모달이라 포커스를 빼앗지 않는다.
		if (!mpPrefs.reduced) requestAnimationFrame(() => (layer ?? document).querySelector<HTMLElement>('.nstart')?.focus());

		return () => {
			restore();
			window.removeEventListener('focus', restore);
			document.removeEventListener('visibilitychange', onvis);
			if (opener && document.contains(opener)) opener.focus();
		};
	});

	// 자동으로 닫히지 않는다. Esc와 버튼으로만 닫히고, 레이어가 떠 있는 동안 Tab은 레이어 안에서만 돈다.
	// 모달 레이어일 때만 스택에 올라 맨 위 모달과 키를 나눈다. 배너는 열린 모달이 있으면 양보한다.
	$effect(() => {
		if (reduced) return;
		stack.push(me);
		return () => stack.splice(stack.indexOf(me), 1);
	});

	function onkeydown(e: KeyboardEvent) {
		if (reduced ? stack.length > 0 : stack[stack.length - 1] !== me) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopImmediatePropagation();
			onclose();
			return;
		}
		if (e.key !== 'Tab' || !layer) return;
		const f = [...layer.querySelectorAll<HTMLElement>('button:not([disabled])')];
		const first = f[0];
		const last = f[f.length - 1];
		if (!layer.contains(document.activeElement)) {
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
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="nudge-wrap">
	{#if reduced}
		<div class="ntop" role="alert">
			<span class="nmsg">{message}</span>
			<span class="nsub">{total}명 중 {ready}명 준비</span>
			<button class="btn nstart" type="button" onclick={onstart}>{startLabel}</button>
			<button class="btn" type="button" onclick={onclose}>닫기</button>
		</div>
	{:else}
		<div bind:this={flashEl} class="nfx" aria-hidden="true"></div>
		<div bind:this={layer} class="nlayer" role="alertdialog" aria-modal="true" aria-labelledby={id}>
			<div bind:this={box} class="nbox">
					<span class="bdg ncount"><Icon name="bell" size="0.875rem" />재촉 {count}회</span>
				<span class="nbellwrap" aria-hidden="true">
					<i class="ring"></i><i class="ring r2"></i>
					<span class="nbellbg"><span class="nbell"><Icon name="bell" size="4rem" /></span></span>
				</span>
				<p class="nmsg" {id}>{message}</p>
					<p class="nready">{total}명 중 <b>{ready}</b>명 준비</p>
				<div class="nbtns">
					<button class="btn primary nstart" type="button" onclick={onstart}>{startLabel}</button>
					<button class="btn" type="button" onclick={onclose}>닫기</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.nudge-wrap {
		position: fixed;
		inset: 0;
		z-index: 42;
		pointer-events: none;
	}
	.nfx {
		position: fixed;
		inset: 0;
		z-index: 43;
		pointer-events: none;
		background: var(--btn-primary);
		opacity: 0;
	}
	.nlayer {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--scrim);
		pointer-events: auto;
	}
	.nbox {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
		width: min(30rem, 100%);
		padding: 2rem 1.5rem 1.75rem;
		border-radius: 0.75rem;
		background: var(--surface);
		color: var(--text);
		text-align: center;
		box-shadow: var(--shadow);
		animation: nudge-pop 200ms ease-out both;
	}
	.nmsg {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.25;
		overflow-wrap: anywhere;
		text-wrap: balance;
	}
	/* 시작까지 몇 명 남았는지가 이 화면에서 방장이 정할 일이라 숫자를 키운다 */
	.nready {
		padding: 0.375rem 1rem;
		border-radius: 0.5rem;
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 2.5rem;
		font-variant-numeric: tabular-nums;
		color: var(--btn-text);
		background: var(--sel-bg);
	}
	.nready b {
		font-size: 2rem;
	}
	.bdg.ncount {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--on-danger);
		background: var(--danger);
		box-shadow: inset 0 0 0 1px var(--on-danger);
	}
	.nbtns {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		width: 100%;
	}
	.nbtns .btn {
		flex: 1 1 8rem;
		min-height: 56px;
		font-size: 1.125rem;
		font-weight: 700;
	}
	.nbellwrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 7rem;
		height: 7rem;
	}
	.ring {
		position: absolute;
		inset: 0.75rem;
		border: 3px solid var(--btn-primary);
		border-radius: 50%;
		animation: nudge-ring 1s ease-out infinite;
	}
	.ring.r2 {
		animation-delay: 0.5s;
	}
	.nbellbg {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 5.5rem;
		height: 5.5rem;
		border-radius: 50%;
		background: var(--btn-primary);
		color: var(--on-tile);
	}
	.nbell {
		display: inline-flex;
		transform-origin: 50% 10%;
		animation: bell-swing 600ms ease-in-out infinite;
	}
	/* 움직임 줄이기: 레이어 대신 상단 고정 배너(전체 폭, 56px 이상) */
	.ntop {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		min-height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding: 0.25rem max(16px, env(safe-area-inset-right, 0px)) 0.25rem max(16px, env(safe-area-inset-left, 0px));
		padding-top: max(0.25rem, env(safe-area-inset-top, 0px));
		background: var(--btn-primary);
		color: var(--on-tile);
		pointer-events: auto;
	}
	.ntop .nmsg {
		font-size: 1.125rem;
	}
	.ntop .nsub {
		font-size: 0.875rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.ntop .btn {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--btn-primary);
		background: var(--on-tile);
	}
	.ntop .btn:hover:not(:disabled) {
		background: var(--on-tile);
		filter: brightness(0.92);
	}
	.ntop .btn:focus-visible {
		outline-color: var(--on-tile);
	}

	@keyframes nudge-pop {
		from {
			transform: scale(1.2);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	@keyframes nudge-ring {
		from {
			transform: scale(1);
			opacity: 0.6;
		}
		to {
			transform: scale(2);
			opacity: 0;
		}
	}
	@keyframes bell-swing {
		0%,
		100% {
			transform: rotate(0);
		}
		25% {
			transform: rotate(-30deg);
		}
		75% {
			transform: rotate(30deg);
		}
	}
</style>
