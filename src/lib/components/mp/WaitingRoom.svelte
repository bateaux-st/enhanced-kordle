<script lang="ts">
	import { tick as nextTick, untrack } from 'svelte';
	import type { MpClient } from '$lib/mp/client.svelte';
	import type { Settings, Snapshot } from '$lib/mp/protocol';
	import { CODE_LENGTH, MAX_PLAYERS, NUDGE_COOLDOWN_MS } from '$lib/mp/rules';
	import ChatPanel from './ChatPanel.svelte';
	import Icon from './Icon.svelte';
	import MpModal from './MpModal.svelte';
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
	const full = $derived(snap.players.length >= MAX_PLAYERS);
	// 읽기 쉽게 3-3으로 끊어 보이기만 한다. 복사하는 링크와 서버의 코드는 그대로다.
	const codeText = $derived(`${snap.code.slice(0, CODE_LENGTH / 2)} ${snap.code.slice(CODE_LENGTH / 2)}`);

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

	// 방장의 설정 편집은 모달이다. 결과에서 "설정 바꾸기"로 왔으면 바로 연다.
	let settingsOpen = $state(false);
	let settingsBtn: HTMLElement | undefined = $state();
	$effect(() => {
		if (!client.wantSettings || !isHost) return;
		client.wantSettings = false;
		settingsOpen = true;
	});
	// 결과에서 열었을 때는 모달이 열린 순간의 포커스가 여는 버튼이 아니므로 닫을 때 직접 돌려놓는다.
	function closeSettings() {
		settingsOpen = false;
		void nextTick().then(() => settingsBtn?.focus());
	}
	// 방장을 잃으면 모달이 조건으로만 사라지고 열림 상태가 남아, 다시 방장이 될 때 저절로 뜬다.
	$effect(() => {
		if (!isHost) settingsOpen = false;
	});

	// ---- 방장 넘기기: 확인 뒤에 보낸다 ----
	let transferTo = $state<string | null>(null);
	let membersHead: HTMLElement | undefined = $state();
	// 대상이 그사이 나가거나 끊기면 대화상자가 저절로 닫힌다.
	const target = $derived(isHost && transferTo ? snap.players.find((p) => p.pid === transferTo && p.connected) : undefined);
	// 대상이 사라지거나 방장을 잃어 대화상자가 조건으로만 닫히면 상태도 비운다. 아니면 대상이 다시 접속할 때 저절로 뜬다.
	$effect(() => {
		if (transferTo && !target) transferTo = null;
	});
	function confirmTransfer() {
		if (target) client.transfer(target.pid);
		transferTo = null;
		// 모달이 포커스를 돌려줄 여는 버튼은 넘기고 나면 사라지는 행에 있다. 행이 바뀌어도 남는 참가자 제목으로 옮긴다.
		void nextTick().then(() => membersHead?.focus());
	}

	// ---- 채팅: 넓은 화면은 참가자 옆 패널, 좁은 화면은 하단 바 버튼과 시트 ----
	const WIDE = '(min-width: 900px)';
	let wide = $state(matchMedia(WIDE).matches);
	$effect(() => {
		const mq = matchMedia(WIDE);
		const sync = () => (wide = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
	const chatLabel = $derived(client.chatUnread ? `채팅, 안 읽은 메시지 ${client.chatUnread}개` : '채팅');

	// 하단 고정 바가 마지막 참가자 행을 가리지 않게 본문 아래에 바 높이만큼 비운다.
	let barH = $state(0);
</script>

<div class="wr" style:padding-bottom="calc({barH}px + 1rem)">
<div class="room-head">
	<button class="btn" type="button" onclick={onleave}><Icon name="back" />나가기</button>
	<div class="id">
		<h1><span class="sr">방 코드 </span><span class="code">{codeText}</span></h1>
		<span class="cnt" role="status"><span class="sr">참가자 </span>{snap.players.length}/{MAX_PLAYERS}</span>
		{#if full}<span class="bdg fullb a-pop">가득</span>{/if}
	</div>
	<button class="btn" type="button" onclick={copyLink}><Icon name="link" />링크 복사</button>
</div>

<section class="card sumcard" aria-label="설정 요약">
	<RoomSettings mode="summary" settings={snap.settings} />
	{#if isHost}
		<button class="btn tog" type="button" aria-haspopup="dialog" bind:this={settingsBtn} onclick={() => (settingsOpen = true)}>
			<Icon name="edit" />설정 바꾸기
		</button>
	{/if}
</section>
{#if isHost}<p class="note editnote">설정을 바꾸면 모두의 준비가 풀립니다.</p>{/if}

<div class="cols" class:wide>
<section aria-label="참가자">
	<div class="card">
		<div class="members-head"><h2 tabindex="-1" bind:this={membersHead}>참가자</h2></div>
		<ul>
			{#each rows as it (it.kind === 'p' ? it.p.pid : `g-${it.g.pid}`)}
				{#if it.kind === 'g'}
					<li class="member a-collapse" aria-hidden="true"><span class="nm">{it.g.name}</span></li>
				{:else}
					{@const p = it.p}
					{@const host = p.pid === snap.hostPid}
					<li class="member a-drop" class:stack={isHost && p.pid !== snap.you}>
						<span class="who">
							{#if host}
								<span class="crown" role="img" aria-label="방장" title="방장">
									<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:1.125rem;height:1.125rem"><path d="M3 18h18l1-11-5.5 4.5L12 4 7.5 11.5 2 7z" /></svg>
								</span>
							{/if}
							<span class="nm">{p.name}</span>
							{#if p.pid === snap.you}<span class="bdg me">나</span>{/if}
						</span>
						<span class="sp"></span>
						{#if host}
							{#if !isHost && me?.ready}
								<button class="btn icon nudgeb" type="button" aria-label="방장 재촉" title="방장에게 시작을 재촉합니다" disabled={cooldownLeft > 0} onclick={nudge}>
									<Icon name="bell" size="1.25rem" />
									{#if cooldownLeft > 0}<span class="cdbadge" aria-label="{cooldownLeft}초 뒤에 다시 재촉할 수 있습니다">{cooldownLeft}</span>{/if}
								</button>
							{/if}
							<span class="bdg stat hostb">방장</span>
						{:else if !p.connected}
							<span class="bdg stat off a-pop"><Icon name="off" size="0.875rem" />접속 끊김</span>
						{:else if p.ready}
							<span class="bdg stat ready a-pop"><Icon name="check" width={3} size="0.875rem" />준비 완료</span>
						{:else}
							<span class="bdg stat idle a-pop"><span class="ring" aria-hidden="true"></span>준비 전</span>
						{/if}
						{#if isHost && !host && p.connected}
							<button class="btn give" type="button" aria-haspopup="dialog" aria-label="{p.name}님에게 방장 넘기기" onclick={() => (transferTo = p.pid)}>
								<Icon name="swap" size="1.125rem" />방장 넘기기
							</button>
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
{#if wide}
	<!-- 카드는 absolute라 높이를 참가자 카드가 정하고, 메시지가 쌓여도 열이 늘어나지 않는다 -->
	<section class="chatcol" aria-label="채팅">
		<div class="card chatcard">
			<div class="members-head"><h2>채팅</h2></div>
			<ChatPanel {client} />
		</div>
	</section>
{/if}
</div>
</div>

{#if target}
	<MpModal title="방장을 넘길까요?" small initialFocus="[data-cancel]" onclose={() => (transferTo = null)}>
		<p class="gtxt">{target.name}님이 방장이 됩니다. 설정과 시작은 새 방장이 합니다.</p>
		<div class="two">
			<button class="btn primary" type="button" onclick={confirmTransfer}>넘기기</button>
			<button class="btn" type="button" data-cancel onclick={() => (transferTo = null)}>취소</button>
		</div>
	</MpModal>
{/if}

{#if isHost && settingsOpen}
	<MpModal title="설정 바꾸기" sheet onclose={closeSettings}>
		<RoomSettings mode="edit" settings={snap.settings} onchange={changeSettings} />
		{#snippet footer()}
			<p class="note">바꾼 설정은 바로 적용됩니다. 설정을 바꾸면 모두의 준비가 풀립니다.</p>
			<button class="btn primary big" type="button" onclick={closeSettings}>닫기</button>
		{/snippet}
	</MpModal>
{/if}

<div class="action-bar" bind:offsetHeight={barH}>
	<div class="ab-in">
		<div class="ab-main">
			{#if !wide}
				<button class="btn chat big" type="button" aria-label={chatLabel} aria-haspopup="dialog" onclick={(e) => client.openChat(e.currentTarget)}>
					<Icon name="chat" size="1.25rem" />채팅
					{#if client.chatUnread}<span class="cbadge" aria-hidden="true">{client.chatUnread}</span>{/if}
				</button>
			{/if}
			{#if isHost}
				<button class="btn primary big wide" class:glow={nudgeCount > 0} type="button" disabled={!snap.host?.canStart} onclick={onstart}>{startLabel}</button>
			{:else}
				<button class="btn big wide" class:primary={!me?.ready} type="button" onclick={() => client.ready(!me?.ready)}>
					{me?.ready ? '준비 취소' : '준비'}
				</button>
			{/if}
		</div>
		{#if isHost}
			<div class="ab-cap">
				{#if nudgeCount > 0}<span class="bdg nbadge" role="status"><Icon name="bell" size="0.875rem" />재촉 {nudgeCount}회</span>{/if}
				{#if !snap.host?.canStart}<span role="status">{startReason}</span>{/if}
			</div>
		{:else}
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
	/* 데스크톱은 한 열 960px. 설정 요약 띠와 참가자 슬롯이 머리줄·하단 바와 같은 폭을 쓴다 */
	.wr {
		max-width: 60rem;
		margin: 0 auto;
	}
	.room-head {
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		padding-right: 4.5rem;
	}
	.id {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		align-self: center;
	}
	h1 {
		font-weight: 700;
	}
	.code {
		display: block;
		padding: 0.125rem 0.625rem;
		border-radius: 0.5rem;
		background: var(--code-bg);
		font-size: 2rem;
		line-height: 2.5rem;
		letter-spacing: 0.08em;
		word-spacing: 0.15em;
		white-space: nowrap;
	}
	.cnt {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.bdg.fullb {
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--muted);
		font-size: 0.75rem;
	}
	.sumcard {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
		padding: 0.875rem 1rem 0.875rem 1.25rem;
	}
	.sumcard > :global(.sum) {
		flex: 1 1 auto;
		min-width: 0;
	}
	.tog {
		flex: none;
		font-size: 0.875rem;
		font-weight: 700;
	}
	.editnote {
		margin-bottom: 1.25rem;
	}
	.gtxt {
		margin-bottom: 1rem;
	}
	.two {
		display: flex;
		gap: 0.5rem;
	}
	.two > * {
		flex: 1;
	}
	/* 900px 이상에서만 두 칸. 채팅 칸은 참가자 카드와 같은 높이로 늘어난다 */
	.cols.wide {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 21.25rem;
		gap: 1.25rem;
		align-items: stretch;
	}
	.chatcol {
		position: relative;
	}
	.chatcard {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
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
	.who {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.give {
		flex: none;
		gap: 0.375rem;
		font-size: 0.875rem;
		font-weight: 700;
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
	/* 상태 칸: 방장·준비 완료·준비 전·접속 끊김이 같은 폭 한 열에 놓인다 */
	.bdg.stat {
		justify-content: center;
		gap: 0.3125rem;
		min-width: 5.5rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		font-size: 0.75rem;
	}
	.bdg.hostb {
		color: var(--on-key);
		background: var(--key);
	}
	.bdg.stat.ready {
		color: var(--on-tile);
		background: var(--btn-primary);
		/* 다크에서 --btn-primary는 카드 면과 2.77:1이라 윤곽을 한 겹 둔다(4.47 / 3.89) */
		box-shadow: inset 0 0 0 1px var(--sel-line);
	}
	.bdg.stat.idle {
		border: 1.5px solid var(--muted);
		color: var(--text);
	}
	.bdg.stat.off {
		border: 1.5px dashed var(--muted);
	}
	.member .bdg.me {
		flex: none;
	}
	.ring {
		width: 0.625rem;
		height: 0.625rem;
		border: 1.5px solid var(--muted);
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
	/* 시작·준비와 사유 문구는 항상 화면 아래에 둔다. 본문은 바 높이만큼 비워 두어 마지막 행이 가려지지 않는다 */
	.action-bar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 4;
		padding: 0.75rem max(16px, env(safe-area-inset-right, 0px)) max(0.75rem, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
		border-top: 1px solid var(--line);
		background: var(--bg);
	}
	.ab-in {
		display: flex;
		align-items: center;
		gap: 1rem;
		max-width: 60rem;
		margin: 0 auto;
	}
	.ab-main {
		display: flex;
		gap: 0.5rem;
	}
	.ab-in .wide {
		min-width: 12rem;
		min-height: 52px;
	}
	.ab-in .chat {
		flex: none;
		min-width: 5.25rem;
		min-height: 52px;
		padding: 0 0.75rem;
		font-size: 0.875rem;
	}
	.ab-cap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.5rem;
		font-size: 0.875rem;
	}
	.bdg.nbadge {
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--on-danger);
		background: var(--danger);
		box-shadow: inset 0 0 0 1px var(--on-danger);
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
		/* 좁은 화면: 코드와 인원이 첫 줄, 나가기·링크 복사가 그 아래 한 줄 */
		.id {
			order: -1;
			width: 100%;
		}
		.code {
			font-size: 1.5rem;
			line-height: 2rem;
		}
		.sumcard {
			flex-direction: column;
			align-items: stretch;
			padding: 0.75rem 1rem;
		}
		.tog {
			width: 100%;
		}
		/* 방장 화면의 행: 이름 위, 상태 아래 두 줄로 쌓고 넘기기 버튼은 오른쪽 끝에 둔다 */
		.member.stack {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'who give' 'stat give';
			align-items: center;
			justify-items: start;
			gap: 0.25rem 0.5rem;
			min-height: 64px;
		}
		.stack .sp {
			display: none;
		}
		.stack .who {
			grid-area: who;
		}
		.stack .bdg.stat {
			grid-area: stat;
		}
		.stack .give {
			grid-area: give;
			grid-row: 1 / span 2;
		}
		.ab-in {
			flex-direction: column;
			align-items: stretch;
			gap: 0.375rem;
		}
		/* 사유 문구가 위, 버튼 줄이 아래. 채팅 버튼은 시작·준비 왼쪽에 붙는다 */
		.ab-cap {
			order: -1;
		}
		.ab-main .wide {
			flex: 1 1 auto;
			min-width: 0;
			min-height: 52px;
		}
	}
</style>
