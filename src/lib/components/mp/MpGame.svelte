<script lang="ts">
	import { untrack } from 'svelte';
	import Board, { type BoardView } from '$lib/components/Board.svelte';
	import Keyboard from '$lib/components/Keyboard.svelte';
	import { CODE_TO_JAMO } from '$lib/jamo';
	import type { MpClient } from '$lib/mp/client.svelte';
	import type { Snapshot } from '$lib/mp/protocol';
	import { STATUS_LABEL } from '$lib/mp/rules';
	import type { Mark } from '$lib/types';
	import Icon from './Icon.svelte';
	import MpModal from './MpModal.svelte';
	import MpResult from './MpResult.svelte';
	import OpponentPanel from './OpponentPanel.svelte';
	import { showToast } from './toast.svelte';

	let { client, snap, onleave, onwait }: { client: MpClient; snap: Snapshot; onleave: () => void; onwait: () => void } = $props();

	const game = $derived(snap.game?.kind === 'comp' ? snap.game : null);
	const me = $derived(game?.me ?? null);
	const n = $derived(me?.n ?? game?.startN ?? 6);
	const tries = $derived(snap.settings.tries);
	const playing = $derived(snap.phase === 'playing' && me?.status === 'playing');
	const myRank = $derived(game?.standings?.find((s) => s.pid === snap.you)?.rank ?? null);

	// 상대: 입장 순. 왼쪽 열 2명, 오른쪽 열 나머지.
	const opponents = $derived(snap.players.filter((p) => p.pid !== snap.you && p.inGame));
	const left = $derived(opponents.slice(0, 2));
	const right = $derived(opponents.slice(2));
	const rankOf = (pid: string) => game?.standings?.find((s) => s.pid === pid)?.rank ?? null;
	const isHost = $derived(snap.hostPid === snap.you);

	// ---- 입력 ----
	let current = $state('');
	let shake = $state(false);
	let busy = $state(false);
	let shakeTimer: ReturnType<typeof setTimeout> | undefined;
	let busyTimer: ReturnType<typeof setTimeout> | undefined;

	function doShake() {
		shake = true;
		clearTimeout(shakeTimer);
		shakeTimer = setTimeout(() => (shake = false), 400);
	}

	const boardView: BoardView = $derived({
		n,
		maxTries: tries,
		rows: me?.rows ?? [],
		marks: me?.marks ?? [],
		current,
		status: playing ? 'playing' : 'over',
		shake,
		invalid: false,
		hints: me?.hints ?? {}
	});

	const keyStates = $derived.by(() => {
		const rank: Record<Mark, number> = { a: 1, p: 2, c: 3 };
		const out: Record<string, Mark> = {};
		me?.rows.forEach((row, r) => {
			[...row].forEach((j, i) => {
				const m = me.marks[r][i];
				if (!out[j] || rank[m] > rank[out[j]]) out[j] = m;
			});
		});
		return out;
	});

	function onkey(k: string) {
		if (!playing || busy) return;
		if (k === 'Enter') {
			if ([...current].length < n) {
				showToast('자모가 부족합니다');
				doShake();
				return;
			}
			if (!client.guess(current)) return;
			busy = true;
			clearTimeout(busyTimer);
			busyTimer = setTimeout(() => (busy = false), 4000);
		} else if (k === 'Backspace') {
			current = [...current].slice(0, -1).join('');
		} else if ([...current].length < n) {
			current += k;
		}
	}

	// 서버가 행을 받아 주면 입력 행을 비운다.
	let lastRows = untrack(() => me?.rows.length ?? 0);
	$effect(() => {
		const len = me?.rows.length ?? 0;
		if (len === lastRows) return;
		lastRows = len;
		current = '';
		busy = false;
	});

	// 내 판이 끝나는 순간 한 번 알린다.
	let lastStatus = untrack(() => me?.status);
	$effect(() => {
		const st = me?.status;
		if (st === lastStatus) return;
		const was = lastStatus;
		lastStatus = st;
		if (was !== 'playing') return;
		if (st === 'solved') showToast(myRank ? `정답입니다 · ${myRank}위` : '정답입니다');
		else if (st === 'failed') showToast('실패했습니다');
		else if (st === 'eliminated') showToast('탈락했습니다');
	});

	// 거절당하면 입력을 남긴 채 흔든다(토스트는 MultiApp이 보여 준다).
	let lastErr = untrack(() => client.error?.id ?? 0);
	$effect(() => {
		const e = client.error;
		if (!e || e.id === lastErr) return;
		lastErr = e.id;
		if (busy) {
			busy = false;
			doShake();
		}
	});

	function onkeydown(e: KeyboardEvent) {
		if (document.querySelector('.mp [aria-modal="true"]')) return;
		const t = e.target as HTMLElement | null;
		if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const j = CODE_TO_JAMO[e.code];
		const k = j ?? (e.key === 'Enter' || e.key === 'Backspace' ? e.key : null);
		if (!k) return;
		// 포커스가 일반 버튼에 있으면 Enter는 그 버튼의 몫이다(키보드 사용자).
		if (e.key === 'Enter' && t?.tagName === 'BUTTON' && !t.classList.contains('key')) return;
		e.preventDefault();
		onkey(k);
	}

	// ---- 힌트·포기 ----
	let confirmGiveUp = $state(false);
	let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
	function giveUp() {
		if (!confirmGiveUp) {
			confirmGiveUp = true;
			clearTimeout(giveUpTimer);
			giveUpTimer = setTimeout(() => (confirmGiveUp = false), 3000);
			return;
		}
		confirmGiveUp = false;
		client.giveUp();
	}

	// ---- 나가기·탈락 처리·결과 ----
	let modal = $state<'leave' | 'result' | null>(null);
	let kickPid = $state<string | null>(null);
	const kickName = $derived(snap.players.find((p) => p.pid === kickPid)?.name ?? '');

	function leave() {
		// 게임 중 나가면 이번 게임에서 빠지니 확인한다. 이미 끝났으면 바로 나간다.
		if (playing) modal = 'leave';
		else onleave();
	}

	// 게임이 끝나면 타일 애니메이션 여유를 두고 결과를 띄운다(개인 모드와 같은 1.2초). 결과 화면에서 다시 들어온 경우는 바로.
	let resultShown = false;
	const joinedAtResult = untrack(() => snap.phase === 'result');
	// snap은 스냅샷마다 새 객체라 phase를 직접 읽으면 effect가 매번 다시 돌아 대기 중인 타이머가 cleanup에 지워진다. 불리언 derived는 값이 같으면 재실행하지 않는다.
	const isResult = $derived(snap.phase === 'result');
	$effect(() => {
		if (!isResult || resultShown) return;
		resultShown = true;
		const t = setTimeout(() => (modal ??= 'result'), joinedAtResult ? 0 : 1200);
		return () => clearTimeout(t);
	});

	const modeLine = $derived(`경쟁 · 단판 · ${n}자${snap.settings.hard ? ' · 하드' : ''}`);
	const lastRowText = $derived.by(() => {
		const rows = me?.rows ?? [];
		if (!rows.length || !me) return '';
		const marks = me.marks[rows.length - 1];
		const word: Record<Mark, string> = { c: '정확', p: '위치 다름', a: '없음' };
		return `${rows.length}번째 시도: ${[...rows[rows.length - 1]].map((j, i) => `${j} ${word[marks[i]]}`).join(', ')}`;
	});
	const liveRank = $derived(game?.standings ?? null);
</script>

<svelte:window {onkeydown} />

<div class="game-head">
	<button class="btn" type="button" onclick={leave}><Icon name="back" />나가기</button>
	<h1 class="game-title">꼬들 - {n}자</h1>
</div>
<div class="mode-line"><span>{modeLine}</span></div>

{#if me && !playing && snap.phase === 'playing'}
	<div class="mystate">
		<span class="bdg {me.status === 'solved' ? 'ready' : 'idle'}">
			<Icon name={me.status === 'solved' ? 'checkc' : 'xc'} />{me.status === 'solved' ? (myRank ? `완료 ${myRank}위` : '완료') : STATUS_LABEL[me.status]}
		</span>
	</div>
{/if}

<div class="strip" role="region" aria-label="상대 진행">
	{#each opponents as p (p.pid)}
		<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} compact canKick={isHost} onkick={() => (kickPid = p.pid)} />
	{/each}
</div>

<div class="arena" style="--rows:{tries}">
	<div class="opp-col">
		{#each left as p (p.pid)}
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} canKick={isHost} onkick={() => (kickPid = p.pid)} />
		{/each}
	</div>

	<div class="center" class:locked={!playing}>
		<Board game={boardView} />
		<Keyboard states={keyStates} {onkey} />
	</div>

	<div class="opp-col">
		{#each right as p (p.pid)}
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} canKick={isHost} onkick={() => (kickPid = p.pid)} />
		{/each}
	</div>
</div>

<p class="sr" aria-live="polite">{lastRowText}</p>

{#if liveRank && snap.phase === 'playing'}
	<section class="live-rank" aria-label="현재 순위">
		<h2>현재 순위</h2>
		<ol>
			{#each liveRank as s (s.pid)}
				<li class:mine={s.pid === snap.you}>
					<span class="rk">{s.tied ? '공동 ' : ''}{s.rank}위</span><span>{s.name}</span>
				</li>
			{/each}
		</ol>
	</section>
{/if}

<div class="actions">
	{#if playing}
		{#if snap.settings.hints}
			<button class="btn" type="button" onclick={() => client.hint()} disabled={me?.hintUsed} title="노란 자모 하나의 실제 위치를 알려줍니다 (한 사람에 한 번)">
				{me?.hintUsed ? '힌트 사용함' : '힌트'}
			</button>
		{/if}
		<button class="btn" class:danger={confirmGiveUp} type="button" onclick={giveUp}>{confirmGiveUp ? '정말 포기?' : '포기'}</button>
	{/if}
	{#if snap.phase === 'result' && modal === null}
		<button class="btn primary" type="button" onclick={() => (modal = 'result')}>결과</button>
	{/if}
</div>

{#if modal === 'result'}
	<MpResult
		{snap}
		{isHost}
		onclose={() => (modal = null)}
		{onleave}
		onagain={() => client.again()}
		onnext={() => client.next()}
		onwait={() => {
			modal = null;
			onwait();
		}}
	/>
{/if}

{#if modal === 'leave'}
	<MpModal title="나가면 이번 게임에서 빠집니다." small over initialFocus="[data-cancel]" onclose={() => (modal = null)}>
		<div class="two">
			<button class="btn danger" type="button" onclick={onleave}>나가기</button>
			<button class="btn" type="button" data-cancel onclick={() => (modal = null)}>취소</button>
		</div>
	</MpModal>
{/if}

{#if kickPid}
	<MpModal title="{kickName}님을 탈락 처리할까요?" small over initialFocus="[data-cancel]" onclose={() => (kickPid = null)}>
		<div class="two">
			<button
				class="btn danger"
				type="button"
				onclick={() => {
					if (kickPid) client.eliminate(kickPid);
					kickPid = null;
				}}>탈락 처리</button
			>
			<button class="btn" type="button" data-cancel onclick={() => (kickPid = null)}>취소</button>
		</div>
	</MpModal>
{/if}

<style>
	.game-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		/* 상대 열 2개 + 중앙 + 열 간격(.arena)과 같은 폭에 머리줄을 맞춘다 */
		max-width: 62rem;
		margin: 0 auto 0.5rem;
		padding-right: 4.5rem;
	}
	.game-title {
		flex: 1 1 auto;
		text-align: center;
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 700;
	}
	.mode-line {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.mystate {
		display: flex;
		justify-content: center;
		margin-bottom: 0.75rem;
	}
	.strip {
		display: none;
	}
	.arena {
		--cw: min(28rem, calc(100vw - 32px - 26rem - 8rem));
		display: grid;
		grid-template-columns: 13rem minmax(0, 28rem) 13rem;
		column-gap: 4rem;
		justify-content: center;
		align-items: stretch;
	}
	.opp-col {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.center {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	/* 개인 Board/Keyboard는 화면 폭 기준으로 크기를 잡는다. 상대 열이 있는 가운데 폭(--cw)에 맞춰 덮어쓴다 */
	.center :global(.board) {
		--tile: min(56px, calc(var(--cw) / var(--n) - 4px));
		padding-bottom: 0.5rem;
	}
	.center :global(.keyboard) {
		/* 셋째 줄은 넓은 키 2개(1.635배)라 키 폭 단위 10.27개 + 여백 36px가 중앙 폭 안에 들어와야 한다 */
		--kw: min(40px, calc((var(--cw) - 36px) / 10.27));
	}
	.center.locked :global(.keyboard) {
		opacity: 0.55;
	}
	.live-rank {
		max-width: 20rem;
		margin: 1rem auto 0;
	}
	.live-rank h2 {
		margin-bottom: 0.375rem;
		font-size: 0.875rem;
		font-weight: 700;
		text-align: center;
	}
	.live-rank ol {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: 0.375rem;
		background: var(--surface);
		overflow: hidden;
	}
	.live-rank li {
		display: flex;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}
	.live-rank li + li {
		border-top: 1px solid var(--line);
	}
	.live-rank li.mine {
		background: var(--sel-bg);
		font-weight: 700;
	}
	.live-rank .rk {
		min-width: 4.5rem;
		font-weight: 700;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.two {
		display: flex;
		gap: 0.5rem;
	}
	.two > * {
		flex: 1 1 auto;
	}

	/* 900px 미만: 상대 카드는 보드 위 한 줄로, 보드는 세로 공간에 맞춰 줄인다 */
	@media (max-width: 899.98px) {
		.arena {
			--cw: calc(100vw - 32px);
			--chrome-h: 490px;
			display: block;
		}
		.opp-col {
			display: none;
		}
		.strip {
			display: flex;
			justify-content: center;
			gap: 8px;
			margin-bottom: 0.5rem;
		}
		.center {
			gap: 0.75rem;
		}
		.center :global(.board) {
			--tile: max(26px, min(56px, calc(var(--cw) / var(--n) - 4px), calc((100dvh - var(--chrome-h)) / var(--rows) - 4px)));
		}
		.center :global(.keyboard) {
			--kw: min(36px, calc((var(--cw) - 18px) / 10.27));
		}
		.center :global(.key) {
			height: 48px;
			margin: 0 1px;
		}
		.mode-line {
			margin-bottom: 0.5rem;
			font-size: 0.75rem;
		}
	}
</style>
