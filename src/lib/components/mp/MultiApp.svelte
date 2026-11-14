<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Theme } from '$lib/game.svelte';
	import { createRoom, roomInfo } from '$lib/mp/api';
	import { MpClient, type CloseReason } from '$lib/mp/client.svelte';
	import { clearSession, readSession, writeSession } from '$lib/mp/identity';
	import type { Snapshot } from '$lib/mp/protocol';
	import { CODE_RE, normalizeName, sameSettings } from '$lib/mp/rules';
	import './mp.css';
	import ConnectionOverlay from './ConnectionOverlay.svelte';
	import Icon from './Icon.svelte';
	import LobbyView from './LobbyView.svelte';
	import MpGame from './MpGame.svelte';
		import MpSettings from './MpSettings.svelte';
	import MpToast from './MpToast.svelte';
	import NickModal from './NickModal.svelte';
	import NudgeLayer from './NudgeLayer.svelte';
	import WaitingRoom from './WaitingRoom.svelte';
	import { unlockAudio } from './nudgeFx';
	import { watchReducedMotion } from './prefs.svelte';
	import { showToast } from './toast.svelte';

	let {
		theme,
		onthemechange,
		initialCode,
		onback
	}: {
		theme: Theme;
		onthemechange: (t: Theme) => void;
		/** `?room=CODE`로 들어왔을 때의 코드. */
		initialCode: string | null;
		onback: () => void;
	} = $props();

	const client = new MpClient();

	type View = 'lobby' | 'room' | 'error';
	const saved = untrack(() => readSession());
	let nick = $state(saved?.name ?? '');
	let view = $state<View>('lobby');
	let origin: 'lobby' | 'link' = 'lobby';
	let lobbyMsg = $state('');
	let errorMsg = $state('');
	let everOpened = $state(false);
	let requestedName = '';
	let settingsOpen = $state(false);
	let lobbyEpoch = $state(0);
	let screenEl: HTMLElement | undefined = $state();

	/** 링크로 왔는데 저장된 닉네임이 없을 때 이름을 먼저 묻는다(S1-N). */
	let pendingCode = $state<string | null>(null);
	let pendingMsg = $state('');

	const snap = $derived(client.snap);

	function clearRoomParam() {
		const url = new URL(location.href);
		if (!url.searchParams.has('room')) return;
		url.searchParams.delete('room');
		history.replaceState(history.state, '', url);
	}

	function enterRoom(code: string, name: string, from: 'lobby' | 'link') {
		origin = from;
		requestedName = name;
		everOpened = false;
		lobbyMsg = '';
		resetNudge();
		view = 'room';
		client.connect(code, name);
	}

	function toLobby(msg = '') {
		client.dispose();
		clearRoomParam();
		resetNudge();
		pendingCode = null;
		lobbyMsg = msg;
		view = 'lobby';
	}

	function leaveRoom() {
		client.leave();
		resetNudge();
		view = 'lobby';
	}

	async function create(): Promise<string | null> {
		const name = normalizeName(nick);
		if (!name) return '닉네임을 입력해 주세요.';
		if (import.meta.env.DEV) {
			enterRoom('', name, 'lobby');
			return null;
		}
		try {
			const res = await createRoom({ token: readSession()?.token, name });
			// 방장 자리는 이 토큰의 uid로 예약되었다. hello가 같은 토큰을 읽도록 먼저 저장한다.
			writeSession(res.session, name);
			enterRoom(res.code, name, 'lobby');
			return null;
		} catch {
			return '서버에 연결할 수 없습니다';
		}
	}

	function join(code: string) {
		const name = normalizeName(nick);
		if (name) enterRoom(code, name, 'lobby');
	}

	function clearAccount() {
		clearSession();
		nick = '';
		lobbyEpoch++;
	}

	// ---- 링크 입장 ----
	onMount(() => {
		const stopMotion = watchReducedMotion();
		const unlock = () => unlockAudio();
		document.addEventListener('pointerdown', unlock);
		document.addEventListener('keydown', unlock);

		if (initialCode !== null) {
			const code = initialCode.toUpperCase();
			if (!CODE_RE.test(code)) {
				errorMsg = '없는 방입니다';
				view = 'error';
			} else if (saved) {
				enterRoom(code, saved.name, 'link');
			} else {
				pendingCode = code;
			}
		}
		return () => {
			stopMotion();
			document.removeEventListener('pointerdown', unlock);
			document.removeEventListener('keydown', unlock);
			client.dispose();
		};
	});

	async function submitPending(name: string) {
		const code = pendingCode;
		if (!code) return;
		pendingMsg = '';
		try {
			const info = await roomInfo(code);
			if (!info) pendingMsg = '없는 방입니다';
			else if (info.inProgress) pendingMsg = '진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다';
			else if (info.players >= info.max) pendingMsg = '방이 가득 찼습니다';
			else {
				nick = name;
				pendingCode = null;
				enterRoom(code, name, 'link');
			}
		} catch {
			pendingMsg = '서버에 연결할 수 없습니다';
		}
	}

	// ---- 연결 상태 ----
	const FAIL_TEXT: Partial<Record<NonNullable<CloseReason>, string>> = {
		full: '방이 가득 찼습니다',
		in_progress: '진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다',
		no_room: '없는 방입니다',
		destroyed: '없는 방입니다',
		bad_name: '닉네임은 5~12자여야 합니다'
	};

	$effect(() => {
		const status = client.status;
		const reason = client.closeReason;
		untrack(() => {
			if (status === 'open') everOpened = true;
			if (status !== 'closed' || view !== 'room' || reason === 'left' || reason === 'replaced') return;
			// 방에 한 번도 못 들어간 채 닫혔다. 이미 들어갔다 끊긴 경우(lost)는 오버레이가 맡는다.
			const text = reason === 'lost' ? (everOpened ? '' : '서버에 연결할 수 없습니다') : (FAIL_TEXT[reason as NonNullable<CloseReason>] ?? '');
			if (!text) return;
			if (origin === 'lobby') toLobby(text);
			else {
				client.dispose();
				errorMsg = text;
				view = 'error';
			}
		});
	});

	const overlay = $derived.by<'reconnect' | 'lost' | 'replaced' | null>(() => {
		if (view !== 'room') return null;
		if (client.status === 'reconnecting') return 'reconnect';
		if (client.status === 'closed' && client.closeReason === 'lost' && everOpened) return 'lost';
		if (client.status === 'closed' && client.closeReason === 'replaced') return 'replaced';
		return null;
	});

	let wasReconnecting = false;
	$effect(() => {
		const s = client.status;
		untrack(() => {
			if (s === 'reconnecting') wasReconnecting = true;
			else if (s === 'open' && wasReconnecting) {
				wasReconnecting = false;
				showToast('다시 연결되었습니다');
			}
		});
	});

	// ---- 서버 거절은 모두 토스트로 ----
	$effect(() => {
		const e = client.error;
		if (e) untrack(() => showToast(e.msg));
	});

	// ---- 방 안 사건을 토스트로: 입장·퇴장·승계·설정 변경·확정 이름 ----
	let prev: Snapshot | null = null;
	/** 토스트는 하나만 남지만 채팅 시스템 줄은 사건마다 쌓는다. */
	function notice(text: string) {
		showToast(text);
		client.addSystemLine(text);
	}
	$effect(() => {
		const s = client.snap;
		untrack(() => {
			const p = prev && s && prev.code === s.code ? prev : null;
			prev = s;
			if (!s) return;
			if (!p) {
				if (client.name && requestedName && client.name !== requestedName) showToast(`같은 이름이 있어 ${client.name} 이름으로 들어왔습니다`);
				return;
			}
			// 방장 승계는 어느 단계에서도 일어나므로 단계 가드보다 앞에 두고 채팅 줄은 항상 남긴다.
			// 토스트는 게임 중과 단계가 바뀐 스냅샷에서는 띄우지 않는다.
			if (s.hostPid && s.hostPid !== p.hostPid) {
				const h = s.players.find((q) => q.pid === s.hostPid);
				const text = s.hostPid === s.you ? '방장이 되었습니다' : `${h?.name ?? ''}님이 방장이 되었습니다`;
				if (s.phase === p.phase && s.phase !== 'playing') {
					resetNudge();
					notice(text);
				} else client.addSystemLine(text);
			}
			if (s.phase !== 'lobby') {
				resetNudge();
				return;
			}
			if (p.phase !== 'lobby') return;
			const was = new Set(p.players.map((q) => q.pid));
			const now = new Set(s.players.map((q) => q.pid));
			for (const q of s.players) if (!was.has(q.pid) && q.pid !== s.you) notice(`${q.name}님이 들어왔습니다`);
			for (const q of p.players) if (!now.has(q.pid)) notice(`${q.name}님이 나갔습니다`);
			if (!sameSettings(p.settings, s.settings)) {
				resetNudge();
				if (s.hostPid !== s.you && p.players.find((q) => q.pid === s.you)?.ready) showToast('방장이 설정을 바꿔 준비가 풀렸습니다');
			}
		});
	});

	// ---- 재촉(방장이 받는다) ----
	let nudgeNames = $state<string[]>([]);
	let nudgeCount = $state(0);
	let nudgeOpen = $state(false);
	let nudgeReplay = $state(0);

	// 시작 조건(StartCheck)과 같은 기준: 접속 중인 방장 외 인원
	const guestsNow = $derived((snap?.players ?? []).filter((p) => p.pid !== snap?.hostPid && p.connected));

	function resetNudge() {
		nudgeNames = [];
		nudgeCount = 0;
		nudgeOpen = false;
	}

	let lastNudge = untrack(() => client.nudge?.id ?? 0);
	$effect(() => {
		const n = client.nudge;
		if (!n || n.id === lastNudge) return;
		lastNudge = n.id;
		untrack(() => {
			if (client.snap?.phase !== 'lobby') return;
			if (!nudgeNames.includes(n.from)) nudgeNames = [...nudgeNames, n.from];
			nudgeCount++;
			nudgeOpen = true;
			nudgeReplay++;
		});
	});

	function startRoom() {
		const s = client.snap;
		if (!s?.host?.canStart) return;
		resetNudge();
		client.start(s.host.disconnected.length > 0);
	}
	function nudgeStart() {
		nudgeOpen = false;
		startRoom();
	}

	// ---- 결과 이후: 방장이 다음 게임을 고르는 동안 ----
	// 참가자가 "대기실로"를 누르면 그 판의 시작 시각을 적어 둔다. 판이 바뀌면 저절로 풀린다.
	let parkedGame = $state<number | null>(null);
	const inGame = $derived(snap?.players.find((p) => p.pid === snap.you)?.inGame ?? false);
	// 결과 중에 들어온 사람(이번 판 참가자가 아님)은 볼 결과가 없어 대기실을 본다(Q9). 방장을 넘겨받았다면 다음 게임을 고를 화면이 필요해 between에 둔다.
	const lateJoiner = $derived(snap?.phase === 'result' && !inGame && snap.hostPid !== snap.you);
	const between = $derived(snap?.phase === 'result' && (!inGame || (snap.game !== null && snap.game.startedAt === parkedGame)));

	const viewKey = $derived(
		view === 'room' ? (client.status === 'dev' ? 'dev' : !snap ? 'load' : snap.phase === 'lobby' || lateJoiner ? 'wait' : between ? 'between' : 'game') : view
	);
</script>

<div class="mp">
	<button class="btn gear" type="button" onclick={() => (settingsOpen = true)}>설정</button>

	<main bind:this={screenEl} class="screen">
		{#key viewKey}
			<div class="in">
				{#if viewKey === 'lobby'}
					{#key lobbyEpoch}
						<LobbyView
							{nick}
							onnick={(v) => (nick = v)}
							message={lobbyMsg}
							dev={import.meta.env.DEV}
							oncreate={create}
							onjoin={join}
							onback={onback}
						/>
					{/key}
				{:else if viewKey === 'wait' && snap}
					<WaitingRoom {client} {snap} {nudgeCount} onstart={startRoom} onleave={leaveRoom} />
				{:else if viewKey === 'game' && snap}
					<MpGame {client} {snap} onleave={leaveRoom} onwait={() => (parkedGame = snap.game?.startedAt ?? null)} />
				{:else if viewKey === 'between' && snap}
					<div class="notice" role="status">
						<!-- 결과 중 방장을 넘겨받은 신규 입장자는 결과 모달이 없어 이 화면에서 직접 고른다. -->
						{#if snap.hostPid === snap.you}
							<p class="t">다음 게임을 골라 주세요.</p>
							<p class="note">고르면 모두 대기실로 이동합니다.</p>
							<div class="two">
								<button class="btn primary" type="button" onclick={() => client.again()}>같은 설정으로 한 판 더</button>
								<button class="btn" type="button" onclick={() => client.next()}>설정 바꾸기</button>
							</div>
						{:else}
							<p class="t">방장이 다음 게임을 고르는 중입니다.</p>
							<p class="note">정해지면 대기실로 이동합니다.</p>
						{/if}
						<div class="two">
							{#if inGame}<button class="btn" type="button" onclick={() => (parkedGame = null)}>결과 보기</button>{/if}
							<button class="btn" type="button" onclick={leaveRoom}><Icon name="exit" />나가기</button>
						</div>
					</div>
				{:else if viewKey === 'load'}
					<div class="notice" role="status">
						<span class="spin big" aria-hidden="true"></span>
						<p>방에 들어가는 중입니다.</p>
						<button class="btn" type="button" onclick={() => toLobby()}>취소</button>
					</div>
				{:else if viewKey === 'dev'}
					<div class="notice">
						<p class="t">개발 서버에서는 방에 들어갈 수 없습니다</p>
						<p class="note">멀티는 <code>pnpm build</code> 뒤 <code>pnpm preview</code>에서 확인합니다.</p>
						<button class="btn primary" type="button" onclick={() => toLobby()}>로비로</button>
					</div>
				{:else if viewKey === 'error'}
					<div class="notice" role="alert">
						<p class="t">{errorMsg}</p>
						<button class="btn primary" type="button" onclick={() => toLobby()}>로비로</button>
					</div>
				{/if}
			</div>
		{/key}
	</main>

	{#if nudgeOpen && viewKey === 'wait'}
		<NudgeLayer
			names={nudgeNames}
			count={nudgeCount}
			total={guestsNow.length}
			ready={guestsNow.filter((p) => p.ready).length}
			replay={nudgeReplay}
			canStart={!!snap?.host?.canStart}
			screen={screenEl}
			onstart={nudgeStart}
			onclose={() => {
				nudgeOpen = false;
				nudgeNames = [];
			}}
		/>
	{/if}

	{#if overlay}
		<ConnectionOverlay kind={overlay} onlobby={() => toLobby()} onretry={() => client.reconnect()} />
	{/if}

	{#if pendingCode}
		<NickModal
			lead="방 {pendingCode}에 들어갈 이름을 정하세요."
			confirm="입장"
			message={pendingMsg}
			onsubmit={(name) => void submitPending(name)}
			oncancel={() => toLobby()}
		/>
	{/if}

	{#if settingsOpen}
		<MpSettings
			{theme}
			{onthemechange}
			onclearaccount={view === 'lobby' ? clearAccount : undefined}
			onclose={() => (settingsOpen = false)}
		/>
	{/if}

	<MpToast />
</div>

<style>
	/* both로 두면 끝난 뒤에도 transform이 남아 안쪽 position: fixed(모달 막, 하단 액션 바)가 화면 대신 이 박스에 묶인다. */
	.in {
		animation: mp-xin var(--mo-fast) ease-out backwards;
	}
	.notice {
		min-height: calc(100dvh - 8rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		text-align: center;
	}
	.notice .t {
		font-size: 1.125rem;
		font-weight: 700;
	}
	code {
		font-weight: 700;
	}
	.two {
		display: flex;
		gap: 0.5rem;
	}
	.two > .primary {
		flex: 1 1 auto;
	}
</style>
