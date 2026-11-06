<script lang="ts">
	import { untrack } from 'svelte';
	import type { MpClient } from '$lib/mp/client.svelte';
	import type { Settings, Snapshot } from '$lib/mp/protocol';
	import { MAX_PLAYERS, NUDGE_COOLDOWN_MS } from '$lib/mp/rules';
	import Icon from './Icon.svelte';
	import RoomSettings from './RoomSettings.svelte';
	import { mpPrefs } from './prefs.svelte';
	import { showToast } from './toast.svelte';

	let {
		client,
		snap,
		nudgeCount,
		onstart,
		onleave
	}: { client: MpClient; snap: Snapshot; nudgeCount: number; onstart: () => void; onleave: () => void } = $props();

	const me = $derived(snap.players.find((p) => p.pid === snap.you));
	const isHost = $derived(snap.hostPid === snap.you);
	const hostName = $derived(snap.players.find((p) => p.pid === snap.hostPid)?.name ?? '');
	const emptySlots = $derived(Math.max(0, MAX_PLAYERS - snap.players.length));

	// ---- 나간 사람은 높이가 접히는 동안 자리에 남긴다 ----
	let ghosts = $state<{ pid: string; name: string; at: number }[]>([]);
	let prev: { pid: string; name: string }[] = [];
	$effect(() => {
		const cur = snap.players.map((p) => ({ pid: p.pid, name: p.name }));
		const ids = new Set(cur.map((p) => p.pid));
		const gone = prev.map((p, at) => ({ ...p, at })).filter((p) => !ids.has(p.pid));
		prev = cur;
		if (!gone.length || mpPrefs.reduced) return;
		untrack(() => (ghosts = [...ghosts, ...gone]));
		setTimeout(() => (ghosts = ghosts.filter((g) => !gone.some((x) => x.pid === g.pid))), 450);
	});
	const rows = $derived.by(() => {
		const out: ({ kind: 'p'; p: Snapshot['players'][number] } | { kind: 'g'; g: (typeof ghosts)[number] })[] = snap.players.map((p) => ({ kind: 'p', p }));
		for (const g of ghosts) out.splice(Math.min(g.at, out.length), 0, { kind: 'g', g });
		return out;
	});

	// ---- 방장 재촉(참가자 쪽): 30초 쿨다운과 미리보기 배너 ----
	let cooldownUntil = $state(0);
	let tick = $state(Date.now());
	let preview = $state<'in' | 'out' | null>(null);
	const cooldownLeft = $derived(Math.max(0, Math.ceil((cooldownUntil - tick) / 1000)));

	$effect(() => {
		if (cooldownUntil <= Date.now()) return;
		tick = Date.now();
		const t = setInterval(() => {
			tick = Date.now();
			if (tick >= cooldownUntil) clearInterval(t);
		}, 500);
		return () => clearInterval(t);
	});

	// 서버가 쿨다운을 알려 주면(새로고침으로 로컬 값을 잃었을 때) 남은 초에 맞춘다.
	// 이전 방에서 남은 오류로 쿨다운이 다시 걸리지 않게 마운트 시점의 오류는 무시한다.
	let lastErr = untrack(() => client.error?.id ?? 0);
	$effect(() => {
		const e = client.error;
		if (!e || e.id === lastErr) return;
		lastErr = e.id;
		if (e.code !== 'cooldown') return;
		const s = /(\d+)초/.exec(e.msg);
		if (s) untrack(() => (cooldownUntil = Date.now() + Number(s[1]) * 1000));
	});

	function nudge() {
		if (cooldownLeft > 0 || !client.sendNudge()) return;
		cooldownUntil = Date.now() + NUDGE_COOLDOWN_MS;
		tick = Date.now();
		showToast('재촉했습니다');
		preview = 'in';
		setTimeout(() => (preview = 'out'), 800);
		setTimeout(() => (preview = null), 1000);
	}

	async function copyLink() {
		const url = `${location.origin}${location.pathname}?room=${snap.code}`;
		try {
			await navigator.clipboard.writeText(url);
			showToast('링크를 복사했습니다');
		} catch {
			showToast('링크를 복사하지 못했습니다');
		}
	}

	// ---- 시작 ----
	const startReason = $derived.by(() => {
		const r = snap.host?.reason;
		if (r === 'alone') return '혼자서는 시작할 수 없습니다';
		if (r === 'waiting') return `${snap.host?.waiting ?? 0}명 대기 중`;
		if (r === 'no_host') return '방장이 접속해야 합니다';
		return '';
	});
	// 끊긴 사람이 있으면 그 사람을 내보내고 시작하는 것이 유일한 시작 버튼이다.
	const dropped = $derived((snap.host?.disconnected ?? []).map((pid) => snap.players.find((p) => p.pid === pid)?.name ?? '').filter(Boolean));
	const startLabel = $derived(
		dropped.length === 0 ? '시작' : dropped.length === 1 ? `${dropped[0]} 내보내고 시작` : `${dropped[0]} 외 ${dropped.length - 1}명 내보내고 시작`
	);

	const changeSettings = (next: Settings) => client.settings(next);

	// 결과에서 "설정 바꾸기"로 왔으면 설정 영역으로 데려간다. 좁은 화면에서는 참가자 목록 아래에 있다.
	let settingsHead: HTMLElement | undefined = $state();
	$effect(() => {
		if (!client.wantSettings || !settingsHead) return;
		client.wantSettings = false;
		settingsHead.scrollIntoView({ block: 'start', behavior: mpPrefs.reduced ? 'auto' : 'smooth' });
		settingsHead.focus({ preventScroll: true });
	});
</script>

<div class="room-head">
	<button class="btn" type="button" onclick={onleave}><Icon name="back" />나가기</button>
	<h1>방 <span class="code">{snap.code}</span></h1>
	<button class="btn" type="button" onclick={copyLink}><Icon name="link" />링크 복사</button>
</div>

<div class="cols">
	<section class="col-a" aria-label="참가자">
		<div class="card">
			<div class="members-head"><h2 role="status">참가자 {snap.players.length}/{MAX_PLAYERS}</h2></div>
			<ul>
				{#each rows as it (it.kind === 'p' ? it.p.pid : `g-${it.g.pid}`)}
					{#if it.kind === 'g'}
						<li class="member a-collapse" aria-hidden="true"><span class="nm">{it.g.name}</span></li>
					{:else}
						{@const p = it.p}
						{@const host = p.pid === snap.hostPid}
						<li class="member a-drop">
							{#if host}
								<span class="crown" role="img" aria-label="방장" title="방장">
									<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:1.125rem;height:1.125rem"><path d="M3 18h18l1-11-5.5 4.5L12 4 7.5 11.5 2 7z" /></svg>
								</span>
							{/if}
							<span class="nm">{p.name}</span>
							{#if p.pid === snap.you}<span class="bdg me">나</span>{/if}
							<span class="sp"></span>
							{#if host}
								{#if !isHost && me?.ready}
									<button class="btn icon nudgeb" type="button" aria-label="방장 재촉" title="방장에게 시작을 재촉합니다" disabled={cooldownLeft > 0} onclick={nudge}>
										<Icon name="bell" size="1.25rem" />
										{#if cooldownLeft > 0}<span class="cdbadge" aria-label="{cooldownLeft}초 뒤에 다시 재촉할 수 있습니다">{cooldownLeft}</span>{/if}
									</button>
								{/if}
							{:else if !p.connected}
								<span class="bdg off a-pop"><Icon name="off" size="0.875rem" />접속 끊김</span>
							{:else if p.ready}
								<span class="bdg ready a-pop"><Icon name="check" width={3} size="0.875rem" />준비 완료</span>
							{:else}
								<span class="bdg idle a-pop"><span class="ring" aria-hidden="true"></span>준비 전</span>
							{/if}
						</li>
					{/if}
				{/each}
				{#each { length: emptySlots } as _, e (e)}
					<li class="member empty">
						<span class="nm">빈 자리</span>
						{#if e === 0}<span class="note">링크나 코드를 보내 친구를 부르세요.</span>{/if}
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="col-b" aria-label="설정">
		<h2 tabindex="-1" bind:this={settingsHead}>설정</h2>
		<RoomSettings settings={snap.settings} editable={isHost} onchange={changeSettings} />
	</section>
</div>

<div class="action-bar">
	<div class="ab-main">
		{#if isHost}
			<button class="btn primary big wide" class:glow={nudgeCount > 0} type="button" disabled={!snap.host?.canStart} onclick={onstart}>{startLabel}</button>
			<div class="ab-cap">
				{#if nudgeCount > 0}<span class="bdg nbadge" role="status">재촉 {nudgeCount}회</span>{/if}
				{#if !snap.host?.canStart}<span role="status">{startReason}</span>{/if}
			</div>
		{:else}
			<button class="btn big wide" class:primary={!me?.ready} type="button" onclick={() => client.ready(!me?.ready)}>
				{me?.ready ? '준비 취소' : '준비'}
			</button>
			<div class="ab-cap"><span role="status">{snap.phase === 'result' ? '방장이 다음 게임을 고르는 중입니다.' : me?.ready ? '방장이 시작하길 기다리는 중' : ''}</span></div>
		{/if}
	</div>
</div>

{#if preview}
	<div class="ntop prev" class:out={preview === 'out'} role="status">
		<span class="nmsg">{me?.name}님이 재촉합니다!</span>
		<span class="nlab">상대 화면에 이렇게 뜹니다</span>
	</div>
{/if}

<style>
	.room-head {
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		padding-right: 4.5rem;
	}
	h1 {
		align-self: center;
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 700;
	}
	.code {
		font-size: 2rem;
		letter-spacing: 0.08em;
		margin-left: 0.25rem;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
		align-items: flex-start;
	}
	.col-a {
		flex: 1 1 22rem;
		min-width: 0;
	}
	.col-b {
		flex: 1 1 22rem;
		min-width: 0;
	}
	.col-b > h2 {
		margin-bottom: 0.75rem;
		font-size: 1rem;
		font-weight: 700;
	}
	.members-head {
		padding: 0.75rem 1rem;
	}
	.members-head h2 {
		font-size: 1rem;
		font-weight: 700;
	}
	.member {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 56px;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--line);
	}
	.nm {
		font-size: 1rem;
		font-weight: 700;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.crown {
		display: inline-flex;
		color: var(--btn-text);
	}
	.empty {
		color: var(--muted);
	}
	.empty .nm {
		font-weight: 500;
	}
	.empty .note {
		margin-left: 0.5rem;
	}
	.a-collapse {
		animation: mp-collapse var(--mo-fade) ease-in both;
		overflow: hidden;
		min-height: 0;
	}
	.ring {
		width: 0.625rem;
		height: 0.625rem;
		border: 2px solid currentColor;
		border-radius: 50%;
	}
	.cdbadge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.625rem;
		font-size: 0.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--on-tile);
		background: var(--btn-primary);
	}
	.action-bar {
		display: flex;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
	.ab-main {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.375rem;
	}
	.wide {
		min-width: 12rem;
	}
	.ab-cap {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		min-height: 1.5rem;
		font-size: 0.875rem;
	}
	.nbadge {
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
		color: var(--on-danger);
		background: var(--danger);
	}
	.glow {
		animation: nudge-glow 1s ease-out infinite;
	}
	@keyframes nudge-glow {
		from {
			box-shadow: 0 0 0 0 var(--sel-line);
		}
		to {
			box-shadow: 0 0 0 10px transparent;
		}
	}
	/* 보낸 쪽 미리보기: 받은 사람 화면의 상단 배너와 같은 모양 */
	.ntop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 42;
		min-height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding: 0.25rem max(16px, env(safe-area-inset-right, 0px)) 0.25rem max(16px, env(safe-area-inset-left, 0px));
		background: var(--btn-primary);
		color: var(--on-tile);
		pointer-events: none;
	}
	.ntop .nmsg {
		font-size: 1.125rem;
		font-weight: 700;
	}
	.ntop .nlab {
		font-size: 0.875rem;
	}
	.ntop.out {
		animation: mp-fadeout var(--mo-fade) ease-in both;
	}

	@media (max-width: 899.98px) {
		.code {
			font-size: 1.5rem;
		}
		.action-bar {
			position: sticky;
			bottom: 0;
			z-index: 4;
			margin-inline: calc(-1 * max(16px, env(safe-area-inset-left, 0px)));
			padding: 0.75rem max(16px, env(safe-area-inset-right, 0px)) max(0.75rem, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
			border-top: 1px solid var(--line);
			background: var(--bg);
		}
		.ab-main {
			width: 100%;
			align-items: stretch;
		}
		.ab-cap {
			justify-content: center;
		}
		.wide {
			width: 100%;
		}
	}
</style>
