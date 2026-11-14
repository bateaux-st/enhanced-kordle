<script lang="ts">
	import { tick, untrack } from 'svelte';
	import Board, { type BoardView } from '$lib/components/Board.svelte';
	import Keyboard from '$lib/components/Keyboard.svelte';
	import { CODE_TO_JAMO } from '$lib/jamo';
	import type { MpClient } from '$lib/mp/client.svelte';
	import type { CoopPickView, PlayerView, Snapshot } from '$lib/mp/protocol';
	import { CLIMB_GRACE_MS, coopNeedsInput, HINT_VOTE_MS, IDLE_WARNING_MS, STAGE_CLEAR_MS } from '$lib/mp/rules';
	import type { Mark } from '$lib/types';
	import CoopPicker from './CoopPicker.svelte';
	import Icon from './Icon.svelte';
	import { statusLabel } from './labels';
	import MpModal from './MpModal.svelte';
	import MpResult from './MpResult.svelte';
	import LiveStandings from './LiveStandings.svelte';
	import MpTimer from './MpTimer.svelte';
	import OpponentChip from './OpponentChip.svelte';
	import OpponentPanel from './OpponentPanel.svelte';
	import OpponentSheet from './OpponentSheet.svelte';
	import StageBand from './StageBand.svelte';
	import { mpPrefs } from './prefs.svelte';
	import { showToast, toastState } from './toast.svelte';

	let { client, snap, onleave, onwait }: { client: MpClient; snap: Snapshot; onleave: () => void; onwait: () => void } = $props();

	const game = $derived(snap.game?.kind === 'comp' ? snap.game : null);
	const coop = $derived(snap.game?.kind === 'coop' ? snap.game : null);
	const me = $derived(game?.me ?? null);
	const tries = $derived(snap.settings.tries);
	const climb = $derived(snap.settings.game === 'climb');
	const myRank = $derived(game?.standings?.find((s) => s.pid === snap.you)?.rank ?? null);
	const nameOf = (pid: string) => snap.players.find((p) => p.pid === pid)?.name ?? '';

	// ---- 협동: 돌림판 연출 ----
	// 서버는 연출을 기다리지 않고 이미 보드에 행을 넣었다. 마지막으로 연출을 마친 pick의 at을 들고 있다가,
	// 그보다 새 돌림판 pick이 오면 그 행을 가린 채 picker를 돌리고, 끝나면 행을 보여 준다.
	// 새로 들어온 사람은 현재 pick을 이미 본 것으로 두어 연출을 되풀이하지 않는다.
	let seenPickAt = $state(untrack(() => coop?.lastPick?.at ?? 0));
	const unseen = $derived(coop?.lastPick && coop.lastPick.at !== seenPickAt ? coop.lastPick : null);
	const held = $derived(unseen?.how === 'roulette' ? unseen : null);

	function wheelDone(p: CoopPickView) {
		if (p.at <= seenPickAt) return;
		seenPickAt = p.at;
		showToast(`정한 단어: ${p.candidates[p.chosen]}`);
	}

	// 투표 결과·즉시 제출은 연출이 없으니 알리기만 한다.
	$effect(() => {
		const p = unseen;
		if (!p || p.how === 'roulette') return;
		seenPickAt = p.at;
		showToast(p.how === 'single' ? '제안이 하나라 바로 냅니다' : `정한 단어: ${p.candidates[p.chosen]}`);
	});

	// 투표 동률로 돌림판이 된 경우에만 이유를 먼저 알린다. 돌림판 방식이면 알릴 것이 없다.
	let announcedAt = 0;
	$effect(() => {
		const h = held;
		if (!h || h.at === announcedAt) return;
		announcedAt = h.at;
		if (h.tally) showToast('동률이라 돌림판으로 정합니다');
	});

	// ---- 등반: 스테이지 클리어 보드 붙잡기 ----
	// 서버는 클리어 즉시 다음 스테이지 보드를 보낸다. 클리어한 보드(lastClear)를 약 2초 보여 준 뒤 새 보드로 넘어간다(Q7).
	// 돌림판이 그 클리어를 만든 행이면 휠이 끝난 뒤에도 잠깐 더 보여 준다.
	const CLEAR_HOLD_MS = 2000;
	const AFTER_WHEEL_MS = 1200;
	const rawClear = $derived(coop ? coop.lastClear : (me?.lastClear ?? null));
	// 처음 열었을 때 이미 지난 클리어(새로고침·재접속)는 붙잡지 않는다.
	let releasedAt = $state(
		untrack(() => {
			const c = coop ? coop.lastClear : (game?.me?.lastClear ?? null);
			return c && client.serverNow() - c.at >= CLEAR_HOLD_MS ? c.at : 0;
		})
	);
	const heldClear = $derived(rawClear && rawClear.at !== releasedAt ? rawClear : null);
	const heldAt = $derived(heldClear?.at ?? 0);
	const wheeling = $derived(held !== null);
	let wheeledForClear = false;
	$effect(() => {
		const at = heldAt;
		if (!at) {
			wheeledForClear = false;
			return;
		}
		if (wheeling) {
			wheeledForClear = true;
			return;
		}
		const left = Math.max(at + CLEAR_HOLD_MS - client.serverNow(), wheeledForClear ? AFTER_WHEEL_MS : 0);
		const t = setTimeout(() => (releasedAt = at), left);
		return () => clearTimeout(t);
	});

	let toastedClearAt = 0;
	$effect(() => {
		const at = heldAt;
		if (!at || at === toastedClearAt || wheeling) return;
		toastedClearAt = at;
		const c = untrack(() => heldClear);
		if (c) showToast(`스테이지 ${c.stage} 클리어`);
	});

	// 연출 중에는 방금 고른 행을 뺀 보드를 보인다.
	const coopBoard = $derived.by(() => {
		const b = coop?.board;
		if (!b) return null;
		const shown = heldClear ? { ...b, stage: heldClear.stage, n: heldClear.n, rows: heldClear.rows, marks: heldClear.marks, hints: {} } : b;
		return held ? { ...shown, rows: shown.rows.slice(0, -1), marks: shown.marks.slice(0, -1) } : shown;
	});
	const meBoard = $derived(me && heldClear ? { ...me, stage: heldClear.stage, n: heldClear.n, rows: heldClear.rows, marks: heldClear.marks, hints: {} } : me);
	const view = $derived(coop ? coopBoard : meBoard);
	const n = $derived(view?.n ?? coop?.startN ?? game?.startN ?? 6);
	const selecting = $derived(snap.phase === 'playing' && (coop?.step?.kind === 'vote' || held !== null));
	const playing = $derived(coop ? snap.phase === 'playing' && coop.status === 'playing' : snap.phase === 'playing' && me?.status === 'playing');
	// 고르는 동안(투표·돌림판)에는 입력을 잠근다.
	// 클리어한 보드를 보여 주는 동안에도 잠근다.
	const inputOk = $derived(playing && !selecting && !heldClear);

	// ---- 제한 시간 ----
	// 경쟁은 내 보드, 협동은 공유 보드의 마감이다. 끈 방은 null이라 줄 자체를 그리지 않는다.
	const deadline = $derived(coop ? coop.board.deadline : (me?.deadline ?? null));
	const clockOn = $derived(playing && deadline !== null);
	// 등반은 스테이지와 남은 시간을 한 띠에 둔다. 끝난 뒤에도 띠는 남고, 시간 초과로 끝났을 때만 0:00을 보인다.
	const bandDeadline = $derived(deadline !== null && (playing || me?.status === 'timeout' || coop?.endReason === 'timeout') ? deadline : null);
	// 등반은 클리어 직후부터 새 스테이지 마감이 나가므로 마감에 연출 2초가 들어 있다. 그 2초는 제한 시간을 가득 찬 값에 붙잡아 둔다.
	const clockCap = $derived(climb && rawClear && deadline !== null ? deadline - (rawClear.at + STAGE_CLEAR_MS) : null);

	// 상대: 입장 순. 왼쪽 열 2명, 오른쪽 열 나머지.
	const opponents = $derived(snap.players.filter((p) => p.pid !== snap.you && p.inGame));
	const left = $derived(opponents.slice(0, 2));
	const right = $derived(opponents.slice(2));
	const rankOf = (pid: string) => game?.standings?.find((s) => s.pid === pid)?.rank ?? null;

	// ---- 경쟁 모바일: 상대 칩을 눌러 그 격자를 내 보드 위에 펼친다 ----
	let openPid = $state<string | null>(null);
	const openOpp = $derived(snap.phase === 'playing' && openPid ? (opponents.find((p) => p.pid === openPid) ?? null) : null);
	const sheetOpen = $derived(openOpp !== null);
	const sheetId = $props.id();
	function closeSheet(refocus = false) {
		const pid = openPid;
		openPid = null;
		if (!refocus || !pid) return;
		void tick().then(() => document.querySelector<HTMLElement>(`.oc[data-pid="${CSS.escape(pid)}"]`)?.focus());
	}
	// 자판은 바깥이 아니다. 격자를 펼친 채로 입력을 이어 갈 수 있어야 한다.
	$effect(() => {
		if (!sheetOpen) return;
		const onesc = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || document.querySelector('.mp [aria-modal="true"]')) return;
			e.preventDefault();
			closeSheet(true);
		};
		const onpointer = (e: PointerEvent) => {
			if ((e.target as Element | null)?.closest('.opps, .keyboard')) return;
			closeSheet();
		};
		window.addEventListener('keydown', onesc);
		window.addEventListener('pointerdown', onpointer);
		return () => {
			window.removeEventListener('keydown', onesc);
			window.removeEventListener('pointerdown', onpointer);
		};
	});
	const othersPlaying = $derived(opponents.some((p) => p.panel?.status === 'playing'));
	const isHost = $derived(snap.hostPid === snap.you);

	// 접속 중인 참가자만 센다(서버 집계와 같다. 나간 사람도 접속 끊김으로 보인다).
	const counted = $derived(snap.players.filter((p) => p.inGame && p.connected));
	const proposals = $derived(coop?.step?.kind === 'propose' ? coop.step.proposals : null);
	const passes = $derived(coop?.step?.kind === 'propose' ? coop.step.passes : []);
	const proposedK = $derived(proposals ? counted.filter((p) => p.pid in proposals).length : 0);
	const passedK = $derived(counted.filter((p) => passes.includes(p.pid)).length);
	const myProposed = $derived(proposals ? snap.you in proposals : false);
	const myPassed = $derived(passes.includes(snap.you));
	const iAmIn = $derived(snap.players.some((p) => p.pid === snap.you && p.inGame && p.connected));
	// 제안이 하나도 없는데 나만 남기고 전원이 패스했으면 서버도 거절한다. 눌러 보게 하지 않고 미리 막는다.
	const passBlocked = $derived(
		!myPassed && proposals !== null && Object.keys(proposals).length === 0 && counted.filter((p) => p.pid !== snap.you).every((p) => passes.includes(p.pid))
	);

	function coopInfo(p: PlayerView) {
		const st = coop?.step;
		const base = { n, word: '', confirmed: false, pass: false, lit: false };
		if (!p.connected) return { ...base, state: 'off' as const, word: st?.kind === 'propose' ? (st.drafts[p.pid] ?? st.proposals[p.pid] ?? '') : '' };
		if (!st) return { ...base, state: 'idle' as const };
		if (st.kind === 'vote') {
			const c = st.candidates.find((x) => x.by.includes(p.pid));
			return c ? { ...base, state: 'proposed' as const, word: c.jamo, confirmed: true } : { ...base, state: 'playing' as const };
		}
		// 패스한 사람의 칸은 비워 둔다. 패스 뒤에 친 글자는 제안하기 전까지 남에게 보이지 않는다.
		if (st.passes.includes(p.pid)) return { ...base, state: 'playing' as const, pass: true };
		const proposal = st.proposals[p.pid];
		const word = st.drafts[p.pid] ?? proposal ?? '';
		return { ...base, state: proposal !== undefined ? ('proposed' as const) : ('playing' as const), word, confirmed: proposal !== undefined && word === proposal, lit: proposal !== undefined };
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
			deadline: st.deadline,
			now: () => client.serverNow(),
			onvote: (i: number) => {
				touch();
				client.vote(i);
			},
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
		hints: view?.hints ?? {},
		proposed: coop !== null && myProposed
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
		touch();
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

	// 확정한 제안을 거두면 그 단어가 입력 행으로 돌아와 고칠 수 있다. 서버도 초안을 같은 단어로 두므로 보낸 초안도 맞춘다.
	// 토스트는 서버가 거둔 것을 확인한 뒤(내 제안이 사라진 스냅샷)에 띄운다. 마지막 제안이 먼저 들어와 거절되면 오류 토스트만 남는다.
	let cancelling = false;
	let passBtn = $state<HTMLButtonElement>();
	let actionsEl = $state<HTMLDivElement>();
	function cancelPropose() {
		const mine = proposals?.[snap.you];
		if (mine === undefined || !client.unpropose()) return;
		touch();
		cancelling = true;
		current = mine;
		sentDraft = mine;
	}
	$effect(() => {
		// 값을 먼저 읽어야 cancelling이 false인 처음에도 myProposed가 의존성이 된다.
		const proposed = myProposed;
		if (!cancelling || proposed) return;
		cancelling = false;
		showToast('제안을 취소했습니다');
		// 포커스된 취소 버튼이 DOM에서 사라지므로 같은 자리의 패스 버튼으로 옮긴다. 패스가 막혀 있으면(제안이 하나도 없음) 처음 켜진 버튼.
		void tick().then(() => {
			if (document.activeElement && document.activeElement !== document.body) return;
			const target = passBtn && !passBtn.disabled ? passBtn : actionsEl?.querySelector<HTMLButtonElement>('button:not(:disabled)');
			target?.focus();
		});
	});

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
	// 연결이 끊겼다 돌아온 스냅샷에서 탈락이 확인되면 끊김 탈락이다(서버는 이유를 따로 보내지 않는다).
	// 재접속이 열린 순간의 스냅샷에 상태 변화가 함께 오므로, 변화가 없는 스냅샷에서만 표시를 지운다.
	let dropped = false;
	let lastStatus = untrack(() => me?.status);
	$effect(() => {
		const st = me?.status;
		if (client.status === 'reconnecting') dropped = true;
		if (st === lastStatus) {
			if (client.status === 'open') dropped = false;
			return;
		}
		const was = lastStatus;
		lastStatus = st;
		const byDrop = dropped;
		dropped = false;
		if (was !== 'playing') return;
		if (st === 'solved') showToast(myRank ? `정답입니다 · ${myRank}위` : '정답입니다');
		else if (st === 'failed') showToast(climb ? '탈락했습니다' : '실패했습니다');
		else if (st === 'eliminated') showToast(byDrop ? '접속이 끊겨 탈락했습니다' : '탈락했습니다');
		else if (st === 'timeout') showToast('시간이 다 됐습니다');
	});

	// 협동은 판 전체가 하나라 실패 순간에 한 번 알린다.
	let lastCoopStatus = untrack(() => coop?.status);
	$effect(() => {
		const st = coop?.status;
		if (st === lastCoopStatus) return;
		const was = lastCoopStatus;
		lastCoopStatus = st;
		if (was === 'playing' && st === 'lost' && coop?.endReason === 'timeout') showToast('시간이 다 됐습니다');
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

	// 전원이 패스해서 제안을 다시 받기 시작한 순간. 서버가 남긴 시각이 바뀌면 한 번 알린다.
	let lastPassReset = untrack(() => coop?.passResetAt ?? 0);
	$effect(() => {
		const at = coop?.passResetAt ?? 0;
		if (at === lastPassReset) return;
		lastPassReset = at;
		if (at) showToast('모두 패스해서 다시 제안합니다');
	});

	// ---- 협동: 힌트 투표 ----
	// 결정은 서버가 한다(통과·부결·30초 마감). 여기 시계는 남은 시간을 보여 줄 뿐이다.
	const hv = $derived(coop && playing ? coop.hintVote : null);
	let hvNow = $state(Date.now());
	$effect(() => {
		if (!hv) return;
		hvNow = client.serverNow();
		const id = setInterval(() => (hvNow = client.serverNow()), 250);
		return () => clearInterval(id);
	});
	const hvLeft = $derived(hv ? Math.max(0, Math.ceil((hv.deadline - hvNow) / 1000)) : 0);

	// 토스트는 화면 위쪽에 고정되어 막대와 겹친다. 막대가 열려 있는 동안은 막대 아래로 내린다.
	let hvEl = $state<HTMLElement>();
	$effect(() => {
		void hvNow;
		const el = hvEl;
		if (el) toastState.top = el.getBoundingClientRect().bottom + 8;
		return () => (toastState.top = null);
	});

	// 통과는 힌트가 보드에 들어오는 토스트가 알린다. 부결과 취소만 따로 알린다.
	let lastVoteEnd = untrack(() => coop?.hintVoteEnd?.at ?? 0);
	$effect(() => {
		const e = coop?.hintVoteEnd;
		if (!e || e.at === lastVoteEnd) return;
		lastVoteEnd = e.at;
		if (coop?.status !== 'playing') return;
		if (e.outcome === 'failed') showToast('힌트 투표가 부결됐습니다');
		else if (e.outcome === 'timeout') showToast('시간 안에 과반이 모이지 않아 부결됐습니다');
		else if (e.outcome === 'moot') showToast('힌트 투표가 취소됐습니다');
	});

	// 거절당하면 입력을 남긴 채 흔든다(토스트는 MultiApp이 보여 준다).
	let lastErr = untrack(() => client.error?.id ?? 0);
	$effect(() => {
		const e = client.error;
		if (!e || e.id === lastErr) return;
		lastErr = e.id;
		cancelling = false;
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
		const plainButton = t?.tagName === 'BUTTON' && !t.classList.contains('key');
		// 포커스가 일반 버튼에 있으면 Enter는 그 버튼의 몫이다(Tab으로 찾아간 키보드 사용자).
		if (e.key === 'Enter' && plainButton) return;
		// 마우스로 누른 버튼은 포커스가 남는다. 자모를 치기 시작하면 놓아야 이어지는 Enter가 제출이 된다.
		if (plainButton) t?.blur();
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

	// ---- 무입력 경고 ----
	// 서버는 모른다. 지금 입력할 것이 있는 사람 화면에서만 60초 타이머가 돌고, 경고는 자동 포기나 퇴장으로 이어지지 않는다.
	// 경쟁은 내가 풀이 중일 때, 협동은 coopNeedsInput이다(제안도 패스도 안 했거나 찍을 후보가 있는데 안 찍었을 때).
	const idleTarget = $derived.by(() => {
		// 끊긴 동안은 스냅샷이 얼어 있어 서버 상태를 믿을 수 없고, 끊김 오버레이가 포커스를 쥐고 있다.
		if (snap.phase !== 'playing' || modal !== null || kickPid !== null || client.status !== 'open') return false;
		if (!coop) return me?.status === 'playing';
		const mine = snap.players.find((p) => p.pid === snap.you);
		const st = coop.step;
		if (coop.status !== 'playing' || held || !st || !mine?.inGame || !mine.connected) return false;
		return coopNeedsInput(st, snap.you);
	});
	let idleWarn = $state(false);
	let idleSeq = $state(0);
	const touch = () => idleSeq++;
	$effect(() => {
		void idleSeq;
		if (!idleTarget) {
			idleWarn = false;
			return;
		}
		const t = setTimeout(() => (idleWarn = true), IDLE_WARNING_MS);
		return () => clearTimeout(t);
	});

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

	// ---- 경쟁 등반: 첫 완주 뒤 유예 ----
	// 마감까지 남은 초는 snap.now로 보정한 시계(client.serverNow)로 센다.
	const graceEnd = $derived(game?.graceEnd ?? null);
	const graceActive = $derived(snap.phase === 'playing' && graceEnd !== null);
	let graceNow = $state(Date.now());
	$effect(() => {
		if (!graceActive) return;
		graceNow = client.serverNow();
		const id = setInterval(() => (graceNow = client.serverNow()), 250);
		return () => clearInterval(id);
	});
	const graceLeft = $derived(graceEnd === null ? 0 : Math.max(0, Math.ceil((graceEnd - graceNow) / 1000)));
	// 스크린 리더에는 매초가 아니라 10초마다 알린다.
	let graceSr = $state(-1);
	$effect(() => {
		if (!graceActive) {
			graceSr = -1;
			return;
		}
		if (graceSr < 0 || graceLeft % 10 === 0) graceSr = graceLeft;
	});
	// 첫 완주자는 완주자가 한 명뿐인 처음 스냅샷에서 기억해 둔다. 완주 순서는 순위표를 받은 사람만 안다.
	const solvers = $derived(snap.players.filter((p) => p.panel?.status === 'solved'));
	let firstPid = $state<string | null>(null);
	$effect(() => {
		if (!graceActive) {
			firstPid = null;
			return;
		}
		if (firstPid === null && solvers.length === 1) firstPid = solvers[0].pid;
	});
	const graceName = $derived(game?.standings?.find((x) => x.finishOrder === 1)?.name || nameOf(firstPid ?? '') || solvers[0]?.name || '');

	// 등반은 길이가 스테이지마다 늘어나므로 제목에는 시작 길이를 두고 지금 스테이지는 띠가 보여 준다.
	const titleN = $derived(climb ? ((coop ?? game)?.startN ?? n) : n);
	const modeLine = $derived(`${coop ? '협동' : '경쟁'} · ${climb ? '등반' : '단판'} · ${titleN}자${snap.settings.hard ? ' · 하드' : ''}`);
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

<div class="game-head" class:w4={game !== null}>
	<button class="btn" type="button" onclick={leave}><Icon name="back" />나가기</button>
	<h1 class="game-title">꼬들 - {titleN}자</h1>
</div>
<div class="mode-line" class:w4={game !== null}><span>{modeLine}</span></div>

{#if clockOn && deadline !== null && !climb}
	<div class="clock a-fadein">
		<MpTimer {deadline} cap={clockCap} now={() => client.serverNow()} />
	</div>
{/if}

{#if graceActive}
	<div class="grace a-drop" role="status">
		<span class="sr">{graceName}님 완주. 남은 시간 {graceSr}초</span>
		<span aria-hidden="true">{graceName}님 완주. 남은 시간 <span class="num" class:urgent={graceLeft <= 10}>{graceLeft}</span>초</span>
		<div class="bar motion-only" aria-hidden="true"><i style="width:{Math.min(100, (graceLeft * 1000 * 100) / CLIMB_GRACE_MS)}%"></i></div>
	</div>
{/if}

{#if hv}
	<!-- 게임을 멈추지 않는 막대. 보드 위에 열어야 폰에서도 화면 안에 보이고, 아래 arena는 grace 배너처럼 보드를 줄여 한 화면에 맞춘다 -->
	<section class="hvote a-drop" aria-label="힌트 투표" bind:this={hvEl}>
		<span class="sr" role="status">{nameOf(hv.by)}님이 힌트를 요청했습니다. 찬성 {hv.yes}, 반대 {hv.no}, 찬성 {hv.needed}명이 필요합니다.</span>
		<div class="hv-txt" aria-hidden="true">
			<p class="hv-t">
				{#if hv.by === snap.you}내 힌트 요청{:else}<span class="hv-nm" title={nameOf(hv.by)}>{nameOf(hv.by)}</span><span>님의 힌트 요청</span>{/if}
			</p>
			<p class="hv-n">찬성 {hv.yes} · 반대 {hv.no} · {hv.needed}명 필요 <span class="nw">· {hvLeft}초</span></p>
		</div>
		{#if hv.by !== snap.you}
			<div class="hv-btns">
				<button
					class="btn"
					type="button"
					aria-pressed={hv.myVote === 'yes'}
					onclick={() => {
						touch();
						client.hintVote(true);
					}}>찬성</button
				>
				<button
					class="btn"
					type="button"
					aria-pressed={hv.myVote === 'no'}
					onclick={() => {
						touch();
						client.hintVote(false);
					}}>반대</button
				>
			</div>
		{/if}
		<div class="bar motion-only" aria-hidden="true"><i style="width:{Math.min(100, (hvLeft * 1000 * 100) / HINT_VOTE_MS)}%"></i></div>
	</section>
{/if}

{#if coop}
	<!-- 협동은 제안한 단어를 읽어야 해서 칩 대신 카드 띠를 그대로 쓴다. 띠가 넘치면 가로로 스크롤되므로 키보드로도 닿아야 한다 -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="strip" role="region" aria-label="상대 진행" tabindex="0">
		{#each opponents as p (p.pid)}
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} compact {climb} coop={coopInfo(p)} />
		{/each}
	</div>
{:else if opponents.length}
	<div class="opps">
		<div class="chips" role="region" aria-label="상대 진행">
			{#each opponents as p (p.pid)}
				<OpponentChip
					player={p}
					{tries}
					rank={rankOf(p.pid)}
					{climb}
					expanded={openOpp?.pid === p.pid}
					controls={sheetId}
					onclick={() => (openPid = openPid === p.pid ? null : p.pid)}
				/>
			{/each}
		</div>
		{#if openOpp}
			<OpponentSheet
				id={sheetId}
				player={openOpp}
				{tries}
				rank={rankOf(openOpp.pid)}
				{climb}
				canKick={isHost}
				onkick={() => openPid && (kickPid = openPid)}
				onclose={() => closeSheet(true)}
			/>
		{/if}
	</div>
{/if}

<div
	class="arena"
	class:w4={game !== null}
	class:has-grace={graceActive}
	class:has-clock={clockOn && !climb}
	class:has-band={climb}
	class:has-state={game !== null}
	class:has-hv={hv !== null}
	class:has-note={coop !== null && playing}
	class:chips-1={game !== null && opponents.length <= 2}
	class:chips-0={game !== null && opponents.length === 0}
	style="--rows:{tries}"
>
	<div class="opp-col">
		{#each left as p (p.pid)}
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} {climb} coop={coop ? coopInfo(p) : null} canKick={isHost && !coop} onkick={() => (kickPid = p.pid)} />
		{/each}
	</div>

	<div class="center" class:locked={!playing || heldClear !== null || voteView !== null} class:dim={selecting}>
		{#if climb && view}
			<StageBand stage={view.stage} deadline={bandDeadline} cap={clockCap} now={() => client.serverNow()} />
		{/if}
		<Board game={boardView} />
		{#if game && me && snap.phase === 'playing'}
			<!-- 내가 끝난 뒤의 상태줄. 끝나기 전에도 같은 높이를 잡아 키보드가 밀리지 않게 한다 -->
			<div class="mystate" class:vacant={playing}>
				{#if !playing}
					<span class="bdg {me.status === 'solved' ? 'ready' : 'idle'}">
						<Icon name={me.status === 'solved' ? 'checkc' : me.status === 'timeout' ? 'clock' : 'xc'} />{me.status === 'solved'
							? myRank
								? `완료 ${myRank}위`
								: '완료'
							: statusLabel(me.status, climb)}
					</span>
					{#if othersPlaying}<span class="wait">다른 사람이 끝나길 기다리는 중입니다.</span>{/if}
				{/if}
			</div>
		{/if}
		{#if held}
			{#key held.at}
				<CoopPicker
					wheel={{
						cands: held.candidates.map((jamo, i) => ({ jamo, names: held.by[i].map(nameOf).filter(Boolean) })),
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
			<OpponentPanel player={p} {tries} rank={rankOf(p.pid)} {climb} coop={coop ? coopInfo(p) : null} canKick={isHost && !coop} onkick={() => (kickPid = p.pid)} />
		{/each}
	</div>

	{#if liveRank && snap.phase === 'playing'}
		<div class="standings">
			<LiveStandings standings={liveRank} players={snap.players} you={snap.you} {climb} />
		</div>
	{/if}
</div>

{#if voteView}
	<!-- 시트는 position: fixed라 container-type이 걸린 .arena 안에 두면 arena 기준으로 잘린다 -->
	<CoopPicker vote={voteView} />
{/if}

{#if coop && playing}
	<!-- 진행 수는 상대 패널의 칩과 테두리가 보여 준다. 여기는 내 상태 한 칸이고, 고르는 동안에도 자리를 지켜 아래 버튼이 움직이지 않게 한다 -->
	<p class="progress" role="status">
		{#if !selecting}
			<span class="sr">제안 {proposedK}/{counted.length}{passedK ? `, 패스 ${passedK}` : ''}{myProposed ? ' · 내 제안 확정' : myPassed ? ' · 내가 패스함' : ''}</span>
			{#if myProposed}
				<span class="me-st prop a-pop" aria-hidden="true"><Icon name="check" width={3} />제안함</span>
			{:else if myPassed}
				<span class="me-st pass a-pop" aria-hidden="true"><Icon name="chevR" />패스</span>
			{/if}
		{/if}
	</p>
{/if}

<p class="sr" aria-live="polite">{lastRowText}</p>

<div class="actions" bind:this={actionsEl}>
	{#if playing}
		{#if coop && isHost && coop.step?.kind === 'propose' && !held}
			<button class="btn primary slot" type="button" onclick={() => client.closeStep()} disabled={!proposals || Object.keys(proposals).length === 0}>마감</button>
		{/if}
		{#if coop && iAmIn && coop.step?.kind === 'propose' && !held}
			<!-- 제안을 확정하면 패스 자리가 제안 취소로 바뀐다. 세 버튼은 같은 최소 폭이라 바뀌어도 마감·힌트 위치가 움직이지 않는다 -->
			{#if myProposed}
				<button class="btn slot" type="button" aria-describedby="cancel-note" onclick={cancelPropose}>제안 취소</button>
			{:else}
				<button
					class="btn slot"
					type="button"
					bind:this={passBtn}
					onclick={() => {
						touch();
						if (!myPassed) {
							// 서버가 내 초안을 지우므로 입력 행도 비운다. 안 비우면 곧 초안이 다시 올라간다.
							current = '';
							sentDraft = '';
						}
						client.pass(!myPassed);
					}}
					disabled={passBlocked}
					title={passBlocked ? '제안이 하나도 없어 패스할 수 없습니다' : '이번 행은 제안하지 않고 넘어갑니다. 다음 행에서는 다시 제안합니다'}
				>
					{myPassed ? '패스 취소' : '패스'}
				</button>
			{/if}
		{/if}
		{#if snap.settings.hints}
			{@const used = coop ? coop.board.hintUsed : me?.hintUsed}
			<button
				class="btn"
				class:slot={coop !== null}
				type="button"
				onclick={() => {
					touch();
					client.hint();
				}}
				disabled={used || hv !== null}
				title="노란 자모 하나의 실제 위치를 알려줍니다 ({climb ? '등반 전체에서 한 번' : coop ? '한 판에 한 번' : '한 사람에 한 번'}{coop ? ', 접속 중인 참가자의 과반이 찬성해야 합니다' : ''})"
			>
				{used ? '힌트 사용함' : hv ? '힌트 투표 중' : '힌트'}
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

{#if coop && playing}
	<!-- 제안 전에도 같은 높이를 잡아 두어 제안 상태가 바뀌어도 버튼 줄이 흔들리지 않는다 -->
	<p class="cancel-note" id="cancel-note" class:off={!(myProposed && coop.step?.kind === 'propose')}><span aria-hidden="true">↑ </span>제안을 취소하면 단어가 입력 행으로 돌아옵니다.</p>
{/if}

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

{#if idleWarn && idleTarget}
	<MpModal
		title="진행 중입니다"
		small
		onclose={() => {
			idleWarn = false;
			touch();
		}}
	>
		<p>60초 동안 입력이 없었습니다.</p>
		<button
			class="btn primary block resume"
			type="button"
			onclick={() => {
				idleWarn = false;
				touch();
			}}>계속하기</button
		>
	</MpModal>
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
	.clock {
		display: flex;
		justify-content: center;
		margin: -0.5rem 0 0.75rem;
	}
	.resume {
		margin-top: 0.75rem;
	}
	.grace {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		max-width: 28rem;
		margin: 0 auto 1rem;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--sel-line);
		border-radius: 0.375rem;
		background: var(--sel-bg);
		font-size: 0.875rem;
		font-weight: 700;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.grace .num {
		display: inline-block;
		min-width: 1.5em;
	}
	.grace .num.urgent {
		animation: mp-pulse 1s ease-in-out infinite;
	}
	.grace .bar {
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		overflow: hidden;
	}
	.grace .bar i {
		display: block;
		height: 100%;
		background: var(--sel-line);
		transition: width 0.25s linear;
	}
	/* 보드 아래 상태줄. 끝나기 전에는 비워 두되 높이는 잡아 키보드 위치가 바뀌지 않는다 */
	.mystate {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		min-height: 1.75rem;
	}
	.mystate.vacant {
		visibility: hidden;
	}
	.wait {
		font-size: 0.8125rem;
		color: var(--muted);
	}
	.strip,
	.opps {
		display: none;
	}
	.standings {
		grid-column: 1 / -1;
		justify-self: center;
		width: min(20rem, 100%);
		margin-top: 1rem;
	}
	.arena {
		/* 100vw는 클래식 스크롤바 폭을 포함해 보드가 좌우로 넘친다. 컨테이너 폭(cqw)은 스크롤바와 좌우 여백을 뺀 값이다. */
		container-type: inline-size;
		--cw: min(28rem, calc(100cqw - 26rem - 8rem));
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
		margin-top: 1rem;
		font-size: 0.875rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* 내 상태 칩. 상대 패널의 제안함·패스 칩과 같은 말과 같은 색이고, 제안함은 패널처럼 2px --sel-line 테두리를 두른다 */
	.me-st {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1875rem 0.625rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.me-st.prop {
		border: 2px solid var(--sel-line);
		padding-block: 0.0625rem;
		color: var(--btn-text);
		background: var(--sel-bg);
	}
	.me-st.pass {
		border: 1px solid var(--muted);
		color: var(--text);
		background: var(--surface);
	}
	.hvote {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.375rem 0.75rem;
		max-width: 28rem;
		margin: 0 auto 1rem;
		padding: 0.5rem 0.875rem 0.625rem;
		border: 1px solid var(--sel-line);
		border-radius: 0.375rem;
		background: var(--sel-bg);
		font-variant-numeric: tabular-nums;
	}
	.hv-txt {
		/* 음절 사이에서 줄이 꺾이면 "요청했습 / 니다"처럼 읽기 어렵다 */
		word-break: keep-all;
	}
	/* 이름이 길면 이름만 말줄임으로 줄여 제목을 한 줄에 둔다(전체 이름은 title과 스크린 리더 문구) */
	.hv-t {
		display: flex;
		font-size: 0.875rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.hv-nm {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.nw {
		white-space: nowrap;
	}
	.hv-n {
		font-size: 0.8125rem;
	}
	.hv-btns {
		display: flex;
		gap: 0.375rem;
	}
	/* 기본 버튼 색은 막대 배경(--sel-bg)과 거의 같아 모양이 사라진다. 고른 쪽은 전역 aria-pressed 스타일을 그대로 쓴다 */
	.hv-btns .btn:not([aria-pressed='true']) {
		border: 1px solid var(--sel-line);
		background: var(--surface);
	}
	.hvote .bar {
		grid-column: 1 / -1;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		overflow: hidden;
	}
	.hvote .bar i {
		display: block;
		height: 100%;
		background: var(--sel-line);
		transition: width 0.25s linear;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.actions .slot {
		min-width: 5rem;
	}
	.cancel-note {
		min-height: 1.25rem;
		margin-top: 0.25rem;
		font-size: 0.8rem;
		line-height: 1.25rem;
		text-align: center;
		color: var(--muted);
	}
	.cancel-note.off {
		visibility: hidden;
	}
	.two {
		display: flex;
		gap: 0.5rem;
	}
	.two > * {
		flex: 1 1 auto;
	}

	/* 1200px 이상 경쟁: 머리글·아레나가 같은 4열 격자(상대 | 보드 | 상대 | 순위)를 쓴다 */
	@media (min-width: 1200px) {
		.game-head.w4,
		.mode-line.w4 {
			display: grid;
			grid-template-columns: 13rem minmax(0, 28rem) 13rem 17rem;
			column-gap: 2rem;
			justify-content: center;
			max-width: none;
			padding-right: 0;
		}
		.game-head.w4 .game-title,
		.mode-line.w4 > span {
			grid-column: 2;
			text-align: center;
		}
		.game-head.w4 > .btn {
			grid-column: 1;
			grid-row: 1;
			justify-self: start;
		}
		.arena.w4 {
			--cw: min(28rem, calc(100cqw - 26rem - 17rem - 6rem));
			grid-template-columns: 13rem minmax(0, 28rem) 13rem 17rem;
			column-gap: 2rem;
		}
		.arena.w4 .standings {
			grid-column: auto;
			justify-self: stretch;
			align-self: start;
			width: auto;
			margin-top: 0;
		}
	}

	/* 900px 미만: 상대 카드는 보드 위 한 줄로, 보드는 세로 공간에 맞춰 줄인다 */
	@media (max-width: 899.98px) {
		.arena {
			--cw: 100cqw;
			/* 보드(열 수·시도 횟수 빼고) 위아래 고정 높이와 .mp 아래 여백까지 잰 값. 상대 띠가 완주자 줄로 길어진 경우(+23px)를 기준으로 잡았다. */
			--chrome-h: calc(510px + var(--x-grace, 0px) + var(--x-clock, 0px) + var(--x-band, 0px) + var(--x-hv, 0px) + var(--x-note, 0px) + var(--x-chips, 0px) + var(--x-state, 0px));
			--tile-floor: 26px;
			--old-strip: 142px;
			display: block;
		}
		/* 유예 배너(+56px)와 남은 시간 줄(+28px)과 힌트 투표 막대(+84px)가 붙으면 그만큼 보드가 쓸 세로 공간이 줄어든다 */
		.arena.has-grace {
			--x-grace: 56px;
		}
		.arena.has-clock {
			--x-clock: 28px;
		}
		.arena.has-hv {
			--x-hv: 84px;
		}
		/* 등반 띠(스테이지+남은 시간 62px)와 위쪽 간격 */
		.arena.has-band {
			--x-band: 74px;
		}
		/* 경쟁은 협동 카드 띠(위 기준 높이에 든 142px) 대신 칩 줄(2줄 104px, 1줄 52px)이 오고, 보드 아래 상태줄(40px)이 자리를 잡는다 */
		.arena.w4 {
			--x-chips: calc(104px - var(--old-strip));
			--x-state: 40px;
		}
		.arena.w4.chips-1 {
			--x-chips: calc(52px - var(--old-strip));
		}
		.arena.w4.chips-0 {
			--x-chips: calc(0px - var(--old-strip));
		}
		/* 협동은 버튼 줄 아래에 제안 취소 안내 한 줄(20px + 위 여백 4px)이 자리를 잡는다 */
		.arena.has-note {
			--x-note: 24px;
		}
		/* 세로 화면은 26px 바닥이 있으면 360x740의 12자 10회가 한 화면에 안 들어간다. 바닥만 낮춘다. */
		@media (orientation: portrait) {
			.arena {
				--tile-floor: 10px;
			}
		}
		.opp-col {
			display: none;
		}
		/* 카드는 폭이 고정이라 5명 방에서 넘치면 띠만 가로로 스크롤된다. 넘치지 않을 때만 가운데로 모은다 */
		.strip {
			display: flex;
			gap: 8px;
			margin-bottom: 0.5rem;
			padding-bottom: 4px;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scrollbar-width: thin;
		}
		.strip > :global(.opp:first-child) {
			margin-left: auto;
		}
		.strip > :global(.opp:last-child) {
			margin-right: auto;
		}
		/* 경쟁 상대 칩: 2열, 4명이면 2줄. 펼친 격자는 칩 줄 바로 아래에 겹친다 */
		.opps {
			position: relative;
			display: block;
			margin-bottom: 0.5rem;
		}
		.chips {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
		}
		.clock {
			margin: -0.25rem 0 0.5rem;
		}
		.center {
			gap: 0.75rem;
		}
		.center :global(.board) {
			/* 바닥(--tile-floor)은 높이가 모자란 화면용이다. 12자가 폭에 들어가는지가 먼저라 폭 상한은 바닥 밖에 둔다. */
			--tile: min(56px, calc(var(--cw) / var(--n) - 4px), max(var(--tile-floor), calc((100dvh - var(--chrome-h)) / var(--rows) - 4px)));
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
