<script lang="ts">
	import { untrack } from 'svelte';
	import Board, { type BoardView } from '$lib/components/Board.svelte';
	import Keyboard from '$lib/components/Keyboard.svelte';
	import { CODE_TO_JAMO } from '$lib/jamo';
	import type { MpClient } from '$lib/mp/client.svelte';
	import type { CoopPickView, CoopStepView, PlayerView, Snapshot } from '$lib/mp/protocol';
	import { STATUS_LABEL } from '$lib/mp/rules';
	import type { Mark } from '$lib/types';
	import CoopPicker from './CoopPicker.svelte';
	import Icon from './Icon.svelte';
	import MpModal from './MpModal.svelte';
	import MpResult from './MpResult.svelte';
	import OpponentPanel from './OpponentPanel.svelte';
	import { mpPrefs } from './prefs.svelte';
	import { showToast } from './toast.svelte';

	let { client, snap, onleave, onwait }: { client: MpClient; snap: Snapshot; onleave: () => void; onwait: () => void } = $props();

	const game = $derived(snap.game?.kind === 'comp' ? snap.game : null);
	const coop = $derived(snap.game?.kind === 'coop' ? snap.game : null);
	const me = $derived(game?.me ?? null);
	const tries = $derived(snap.settings.tries);
	const myRank = $derived(game?.standings?.find((s) => s.pid === snap.you)?.rank ?? null);
	const nameOf = (pid: string) => snap.players.find((p) => p.pid === pid)?.name ?? '';

	// ---- 협동: 돌림판 연출 ----
	// 서버는 연출을 기다리지 않고 이미 보드에 행을 넣었다. 마지막으로 연출을 마친 pick의 at을 들고 있다가,
	// 그보다 새 돌림판 pick이 오면 그 행을 가린 채 picker를 돌리고, 끝나면 행을 보여 준다.
	// 새로 들어온 사람은 현재 pick을 이미 본 것으로 두어 연출을 되풀이하지 않는다.
	let seenPickAt = $state(untrack(() => coop?.lastPick?.at ?? 0));
	const unseen = $derived(coop?.lastPick && coop.lastPick.at !== seenPickAt ? coop.lastPick : null);
	const held = $derived(unseen?.how === 'roulette' ? unseen : null);

	// 돌림판 후보의 제안자 이름. pick은 후보 자모열만 들고 있어서, 고르기 직전 스냅샷의 단계에서 읽어 둔다.
	// 같은 스냅샷에서 행이 가려져야 하므로 DOM 갱신 전에(pre) 잡는다.
	let wheelNames = $state.raw<string[][]>([]);
	let lastStep: CoopStepView | null = untrack(() => coop?.step ?? null);
	let capturedAt = untrack(() => coop?.lastPick?.at ?? 0);
	$effect.pre(() => {
		const g = coop;
		untrack(() => {
			const before = lastStep;
			lastStep = g?.step ?? null;
			const p = g?.lastPick;
			if (!p || p.how !== 'roulette' || p.at === seenPickAt || p.at === capturedAt) return;
			capturedAt = p.at;
			wheelNames = namesFor(before, p.candidates);
		});
	});

	function namesFor(before: CoopStepView | null, jamos: string[]): string[][] {
		const by: Record<string, string[]> = {};
		const placed = new Set<string>();
		const add = (pid: string, jamo: string) => {
			(by[jamo] ??= []).push(nameOf(pid));
			placed.add(pid);
		};
		if (before?.kind === 'vote') for (const c of before.candidates) for (const pid of c.by) add(pid, c.jamo);
		else if (before?.kind === 'propose') for (const [pid, jamo] of Object.entries(before.proposals)) add(pid, jamo);
		const out = jamos.map((j) => by[j] ?? []);
		// 마지막 제안이 돌림판을 연 경우 그 사람의 제안은 직전 스냅샷에 없다. 이름 없는 후보가 하나면 남은 한 명의 것이다.
		if (before?.kind === 'propose') {
			const rest = snap.players.filter((p) => p.inGame && p.connected && !placed.has(p.pid));
			const blank = out.filter((o) => o.length === 0);
			if (rest.length === 1 && blank.length === 1) blank[0].push(rest[0].name);
		}
		return out;
	}

	function wheelDone(p: CoopPickView) {
		if (p.at <= seenPickAt) return;
		seenPickAt = p.at;
		showToast(`${p.candidates[p.chosen]}(으)로 정했습니다`);
	}

	// 투표 결과·즉시 제출은 연출이 없으니 알리기만 한다.
	$effect(() => {
		const p = unseen;
		if (!p || p.how === 'roulette') return;
		seenPickAt = p.at;
		showToast(p.how === 'single' ? '제안이 하나라 바로 냅니다' : `${p.candidates[p.chosen]}(으)로 정했습니다`);
	});

	// 투표 동률로 돌림판이 된 경우에만 이유를 먼저 알린다. 돌림판 방식이면 알릴 것이 없다.
	let announcedAt = 0;
	$effect(() => {
		const h = held;
		if (!h || h.at === announcedAt) return;
		announcedAt = h.at;
		if (h.tally) showToast('동률이라 돌림판으로 정합니다');
	});

	// 연출 중에는 방금 고른 행을 뺀 보드를 보인다.
	const coopBoard = $derived.by(() => {
		const b = coop?.board;
		if (!b) return null;
		return held ? { ...b, rows: b.rows.slice(0, -1), marks: b.marks.slice(0, -1) } : b;
	});
	const view = $derived(coop ? coopBoard : me);
	const n = $derived(view?.n ?? coop?.startN ?? game?.startN ?? 6);
	const selecting = $derived(snap.phase === 'playing' && (coop?.step?.kind === 'vote' || held !== null));
	const playing = $derived(coop ? snap.phase === 'playing' && coop.status === 'playing' : snap.phase === 'playing' && me?.status === 'playing');
	// 고르는 동안(투표·돌림판)에는 입력을 잠근다.
	const inputOk = $derived(playing && !selecting);

	// 상대: 입장 순. 왼쪽 열 2명, 오른쪽 열 나머지.
	const opponents = $derived(snap.players.filter((p) => p.pid !== snap.you && p.inGame));
	const left = $derived(opponents.slice(0, 2));
	const right = $derived(opponents.slice(2));
	const rankOf = (pid: string) => game?.standings?.find((s) => s.pid === pid)?.rank ?? null;
	const isHost = $derived(snap.hostPid === snap.you);

	// 접속 중인 참가자만 센다(서버 집계와 같다. 나간 사람도 접속 끊김으로 보인다).
	const counted = $derived(snap.players.filter((p) => p.inGame && p.connected));
	const proposals = $derived(coop?.step?.kind === 'propose' ? coop.step.proposals : null);
	const proposedK = $derived(proposals ? counted.filter((p) => p.pid in proposals).length : 0);
	const myProposed = $derived(proposals ? snap.you in proposals : false);

	function coopInfo(p: PlayerView) {
		const st = coop?.step;
		const base = { n, word: '', confirmed: false };
		if (!p.connected) return { ...base, state: 'off' as const, word: st?.kind === 'propose' ? (st.drafts[p.pid] ?? st.proposals[p.pid] ?? '') : '' };
		if (!st) return { ...base, state: 'idle' as const };
		if (st.kind === 'vote') {
			const c = st.candidates.find((x) => x.by.includes(p.pid));
			return c ? { ...base, state: 'proposed' as const, word: c.jamo, confirmed: true } : { ...base, state: 'playing' as const };
		}
		const proposal = st.proposals[p.pid];
		const word = st.drafts[p.pid] ?? proposal ?? '';
		return { ...base, state: proposal !== undefined ? ('proposed' as const) : ('playing' as const), word, confirmed: proposal !== undefined && word === proposal };
	}

	const voteView = $derived.by(() => {
		const st = coop?.step;
		if (st?.kind !== 'vote' || held) return null;
		return {
			cands: st.candidates.map((c, i) => ({
				jamo: c.jamo,
				names: c.by.map(nameOf),
				mine: c.by.includes(snap.you),
				count: st.tally[i] ?? 0,
				picked: st.myVote === i
			})),
			k: counted.filter((p) => st.voted.includes(p.pid)).length,
			m: counted.length,
			isHost,
			onvote: (i: number) => client.vote(i),
			onclose: () => client.closeStep()
		};
	});

	// ---- 입력 ----
	// 협동은 새로고침해도 서버가 들고 있는 내 초안에서 이어 간다.
	const myDraft = untrack(() => (coop?.step?.kind === 'propose' ? (coop.step.drafts[snap.you] ?? '') : ''));
	let current = $state(myDraft);
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
		rows: view?.rows ?? [],
		marks: view?.marks ?? [],
		current,
		status: inputOk ? 'playing' : 'over',
		shake,
		invalid: false,
		hints: view?.hints ?? {}
	});

	const keyStates = $derived.by(() => {
		const rank: Record<Mark, number> = { a: 1, p: 2, c: 3 };
		const out: Record<string, Mark> = {};
		const v = view;
		v?.rows.forEach((row, r) => {
			[...row].forEach((j, i) => {
				const m = v.marks[r][i];
				if (!out[j] || rank[m] > rank[out[j]]) out[j] = m;
			});
		});
		return out;
	});

	function onkey(k: string) {
		// 협동의 busy는 거절 때 흔들 근거일 뿐이다. 같은 제안을 다시 보내면 스냅샷이 오지 않으니 입력을 막지 않는다.
		if (!inputOk || (busy && !coop)) return;
		if (k === 'Enter') {
			if ([...current].length < n) {
				showToast('자모가 부족합니다');
				doShake();
				return;
			}
			if (!(coop ? client.propose(current) : client.guess(current))) return;
			busy = true;
			clearTimeout(busyTimer);
			busyTimer = setTimeout(() => (busy = false), coop ? 1500 : 4000);
		} else if (k === 'Backspace') {
			current = [...current].slice(0, -1).join('');
		} else if ([...current].length < n) {
			current += k;
		}
	}

	// 서버가 행을 받아 주면 입력 행을 비운다(협동은 연출이 끝나 행이 보이는 때).
	// 서버도 이 순간 초안을 비우므로 마지막으로 보낸 초안도 비운 것으로 맞춘다.
	let lastRows = untrack(() => view?.rows.length ?? 0);
	let sentDraft = myDraft;
	$effect(() => {
		const len = view?.rows.length ?? 0;
		if (len === lastRows) return;
		lastRows = len;
		current = '';
		sentDraft = '';
		busy = false;
	});

	// 내용이 바뀐 뒤 300ms 조용하면 한 번 보낸다. 빈 문자열도 보내야 상대 패널이 비워진다.
	// 제안 단계가 아니면 서버가 거절하니 보내지 않고, 단계가 돌아오면 지금 입력을 다시 알린다.
	const proposing = $derived(inputOk && coop?.step?.kind === 'propose');
	$effect(() => {
		if (!proposing) {
			sentDraft = '';
			return;
		}
		const text = current;
		if (text === sentDraft) return;
		const t = setTimeout(() => {
			if (client.draft(text)) sentDraft = text;
		}, 300);
		return () => clearTimeout(t);
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

	// 공유 힌트: 누가 썼는지와 결과를 전원에게 알린다.
	let lastHints = untrack(() => Object.keys(coop?.board.hints ?? {}).length);
	$effect(() => {
		const b = coop?.board;
		if (!b) return;
		const keys = Object.keys(b.hints);
		const grew = keys.length > lastHints;
		lastHints = keys.length;
		if (!grew) return;
		const pos = Number(keys[keys.length - 1]);
		showToast(`${b.hintBy ? nameOf(b.hintBy) : ''}님 힌트: ${b.hints[pos]}은(는) ${pos + 1}번째 칸`);
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
	// 돌림판 연출이 남았으면 그 행이 보인 뒤부터 센다.
	let resultShown = false;
	const joinedAtResult = untrack(() => snap.phase === 'result');
	// snap은 스냅샷마다 새 객체라 phase를 직접 읽으면 effect가 매번 다시 돌아 대기 중인 타이머가 cleanup에 지워진다. 불리언 derived는 값이 같으면 재실행하지 않는다.
	const isResult = $derived(snap.phase === 'result' && held === null);
	$effect(() => {
		if (!isResult || resultShown) return;
		resultShown = true;
		const t = setTimeout(() => (modal ??= 'result'), joinedAtResult ? 0 : 1200);
		return () => clearTimeout(t);
	});

	const modeLine = $derived(`${coop ? '협동' : '경쟁'} · 단판 · ${n}자${snap.settings.hard ? ' · 하드' : ''}`);
	const lastRowText = $derived.by(() => {
		const rows = view?.rows ?? [];
		if (!rows.length || !view) return '';
		const marks = view.marks[rows.length - 1];
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
		<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} compact coop={coop ? coopInfo(p) : null} canKick={isHost && !coop} onkick={() => (kickPid = p.pid)} />
	{/each}
</div>

<div class="arena" style="--rows:{tries}">
	<div class="opp-col">
		{#each left as p (p.pid)}
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} coop={coop ? coopInfo(p) : null} canKick={isHost && !coop} onkick={() => (kickPid = p.pid)} />
		{/each}
	</div>

	<div class="center" class:locked={!playing} class:dim={selecting}>
		<Board game={boardView} />
		{#if voteView}
			<CoopPicker vote={voteView} />
		{:else if held}
			{#key held.at}
				<CoopPicker
					wheel={{
						cands: held.candidates.map((jamo, i) => ({ jamo, names: wheelNames[i] ?? [] })),
						chosen: held.chosen,
						delay: held.tally ? 300 : 0,
						reduced: mpPrefs.reduced,
						ondone: () => held && wheelDone(held)
					}}
				/>
			{/key}
		{:else}
			<Keyboard states={keyStates} {onkey} />
		{/if}
	</div>

	<div class="opp-col">
		{#each right as p (p.pid)}
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} coop={coop ? coopInfo(p) : null} canKick={isHost && !coop} onkick={() => (kickPid = p.pid)} />
		{/each}
	</div>
</div>

{#if coop && playing}
	<!-- 고르는 동안에도 자리를 지켜 아래 버튼이 움직이지 않게 한다 -->
	<p class="progress" role="status">
		{#if !selecting}
			제안 {proposedK}/{counted.length}
			{#if myProposed}<span class="bdg ready"><Icon name="check" width={3} />제안함</span>{/if}
		{/if}
	</p>
{/if}

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
		{#if coop && isHost && coop.step?.kind === 'propose' && !held}
			<button class="btn primary" type="button" onclick={() => client.closeStep()} disabled={!proposals || Object.keys(proposals).length === 0}>마감</button>
		{/if}
		{#if snap.settings.hints}
			{@const used = coop ? coop.board.hintUsed : me?.hintUsed}
			<button
				class="btn"
				type="button"
				onclick={() => client.hint()}
				disabled={used}
				title="노란 자모 하나의 실제 위치를 알려줍니다 ({coop ? '한 판에 한 번' : '한 사람에 한 번'})"
			>
				{used ? '힌트 사용함' : '힌트'}
			</button>
		{/if}
		{#if !coop || isHost}
			<button class="btn" class:danger={confirmGiveUp} type="button" onclick={giveUp}>{confirmGiveUp ? '정말 포기?' : '포기'}</button>
		{/if}
	{/if}
	{#if isResult && modal === null}
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
	/* 고르는 동안 보드를 한 단계 뒤로 물린다 */
	.center.dim :global(.board) {
		opacity: 0.6;
		transition: opacity var(--mo-fade);
	}
	.progress {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 1.5rem;
		margin-top: 1.5rem;
		font-size: 0.875rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
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
		.progress {
			margin-top: 0.75rem;
		}
	}
</style>
