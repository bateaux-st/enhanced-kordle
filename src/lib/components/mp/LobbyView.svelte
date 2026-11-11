<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { listRooms, roomInfo } from '$lib/mp/api';
	import { watchLobby } from '$lib/mp/lobby-feed';
	import type { RoomSummary } from '$lib/mp/protocol';
	import { CODE_LENGTH, MAX_PLAYERS, NAME_MAX, NAME_MIN, normalizeName } from '$lib/mp/rules';
	import Icon from './Icon.svelte';

	let {
		nick,
		onnick,
		message = '',
		dev,
		oncreate,
		onjoin,
		onback
	}: {
		nick: string;
		onnick: (name: string) => void;
		/** 입장에 실패해 로비로 돌아왔을 때 이유. */
		message?: string;
		dev: boolean;
		/** 실패하면 사유 문구를 돌려준다. */
		oncreate: () => Promise<string | null>;
		onjoin: (code: string) => void;
		onback: () => void;
	} = $props();

	let list = $state<{ state: 'loading' | 'ok' | 'error'; rooms: RoomSummary[] }>({ state: 'loading', rooms: [] });
	let code = $state('');
	// 처음 들어올 때의 닉네임만 본다. 이후 편집 여부는 사용자가 정한다.
	let editing = $state(untrack(() => !nick));
	let busy = $state(false);
	let notice = $state('');
	let nickInput: HTMLInputElement | undefined = $state();
	let prevNick = untrack(() => nick);
	let seq = 0;

	const nameOk = $derived(normalizeName(nick) !== null);
	const nameShort = $derived(nick.trim().length > 0 && !nameOk && [...nick.trim()].length < NAME_MIN);
	const shownMsg = $derived(notice || message);

	async function load(showSpinner: boolean) {
		if (dev) {
			list = { state: 'error', rooms: [] };
			return;
		}
		const mine = ++seq;
		if (showSpinner) list = { state: 'loading', rooms: list.rooms };
		try {
			const rooms = await listRooms();
			if (mine === seq) list = { state: 'ok', rooms };
		} catch {
			if (mine === seq) list = { state: 'error', rooms: [] };
		}
	}

	onMount(() => {
		void load(true);
		// 개발 서버는 WS가 안 되므로 목록이 없는 지금 화면 그대로 둔다.
		const stop = dev
			? () => {}
			: watchLobby({
					onRooms: (rooms) => {
						// 늦게 도착한 GET 응답이 방금 받은 푸시를 덮지 않게 한다.
						seq++;
						list = { state: 'ok', rooms };
					},
					onFallback: () => void load(false)
				});
		if (editing) void focusNick();
		return stop;
	});

	async function focusNick() {
		await tick();
		nickInput?.focus();
		nickInput?.select();
	}

	function startEdit() {
		prevNick = nick;
		editing = true;
		void focusNick();
	}
	function doneEdit() {
		if (!nameOk) return;
		onnick(nick.trim());
		editing = false;
	}
	function cancelEdit() {
		onnick(prevNick);
		editing = !prevNick;
	}

	function tagOf(r: RoomSummary): 'run' | 'full' | 'wait' {
		return r.inProgress ? 'run' : r.players >= r.max ? 'full' : 'wait';
	}
	const TAG_LABEL = { run: '진행 중', full: '가득', wait: '대기 중' };
	const TAG_REASON = { run: '진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다', full: '방이 가득 찼습니다', wait: '' };

	// 입장할 수 없는 방까지 포함해 목록에 있는 상태를 센다.
	const counts = $derived({
		wait: list.rooms.filter((r) => tagOf(r) === 'wait').length,
		run: list.rooms.filter((r) => tagOf(r) === 'run').length,
		full: list.rooms.filter((r) => tagOf(r) === 'full').length
	});

	async function create() {
		if (!nameOk || busy) return;
		busy = true;
		notice = '';
		notice = (await oncreate()) ?? '';
		busy = false;
	}

	async function joinByCode() {
		const c = code.toUpperCase();
		if (!nameOk || busy || c.length !== CODE_LENGTH) return;
		busy = true;
		notice = '';
		try {
			const info = await roomInfo(c);
			if (!info) notice = '없는 방입니다';
			else if (info.inProgress) notice = '진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다';
			else if (info.players >= info.max) notice = '방이 가득 찼습니다';
			else onjoin(c);
		} catch {
			notice = '서버에 연결할 수 없습니다';
		}
		busy = false;
	}

	function joinFromList(r: RoomSummary) {
		if (!nameOk || tagOf(r) !== 'wait') return;
		notice = '';
		onjoin(r.code);
	}

	// 요약에 없는 값(이 필드가 생기기 전에 저장된 방)은 배지를 그리지 않는다.
	function tagsOf(r: RoomSummary): { text: string; strong: boolean }[] {
		const out = [
			{ text: r.kind === 'coop' ? '협동' : '경쟁', strong: true },
			{ text: r.game === 'climb' ? '등반' : '단판', strong: true }
		];
		if (r.length !== undefined) out.push({ text: r.length === 'random' ? '랜덤 길이' : `${r.length}자`, strong: false });
		if (r.tries !== undefined) out.push({ text: `시도 ${r.tries}회`, strong: false });
		if (r.hard) out.push({ text: '하드', strong: false });
		if (r.timer) out.push({ text: '제한 시간', strong: false });
		return out;
	}
</script>

<div class="lobby">
<div class="page-head" class:editing>
	<button class="btn" type="button" onclick={onback}><Icon name="back" /><span class="bk">뒤로</span></button>
	<h1>같이 하기</h1>
	{#if editing}
		<form
			class="nickedit"
			onsubmit={(e) => {
				e.preventDefault();
				doneEdit();
			}}
		>
			<label class="sr" for="nick">닉네임</label>
			<input
				id="nick"
				class="input"
				type="text"
				placeholder="이름"
				maxlength={NAME_MAX}
				autocomplete="off"
				aria-describedby="nick-count"
				bind:this={nickInput}
				value={nick}
				oninput={(e) => onnick(e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						e.preventDefault();
						cancelEdit();
					}
				}}
			/>
			<span id="nick-count" class="note count"><span class="sr">글자 수 </span>{[...nick].length}/{NAME_MAX}</span>
			<button class="btn primary" type="submit" disabled={!nameOk}>확인</button>
			{#if !nameOk}<span class="note" role="status">{nameShort ? `${NAME_MIN}자 이상 입력하세요` : '닉네임을 입력해 주세요.'}</span>{/if}
		</form>
	{:else}
		<button class="btn chip" type="button" aria-label="닉네임 수정: {nick}" onclick={startEdit}>
			<span class="nm">{nick}</span><Icon name="edit" />
		</button>
	{/if}
</div>

{#if dev}
	<p class="dev" role="note">
		개발 서버(<code>pnpm dev</code>)에서는 방에 들어갈 수 없습니다. 멀티는 <code>pnpm build</code> 뒤 <code>pnpm preview</code>에서 확인합니다.
	</p>
{/if}

<div class="toolbar">
	<div class="tb-act">
		<button class="btn primary big" type="button" disabled={!nameOk || busy} onclick={create}>방 만들기</button>
		<div class="tb-codebox">
			<form
				class="tb-code"
				onsubmit={(e) => {
					e.preventDefault();
					void joinByCode();
				}}
			>
				<label class="sr" for="code">방 코드</label>
				<input
					id="code"
					class="input code"
					type="text"
					placeholder="6자리 코드"
					maxlength={CODE_LENGTH}
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					aria-describedby="code-rule"
					value={code}
					oninput={(e) => {
						code = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
						e.currentTarget.value = code;
						notice = '';
					}}
				/>
				<button class="btn" type="submit" disabled={!nameOk || code.length !== CODE_LENGTH || busy}>입장</button>
			</form>
			<p id="code-rule" class="note">방 코드는 {CODE_LENGTH}자입니다</p>
		</div>
	</div>
	<div class="tb-info">
		<span class="tb-count" role="status">
			<b>공개 방 {list.state === 'ok' ? list.rooms.length : 0}</b>
			{#if list.state === 'ok' && list.rooms.length > 0}
				<span class="tb-split">대기 {counts.wait} · 진행 중 {counts.run}{counts.full > 0 ? ` · 가득 ${counts.full}` : ''}</span>
			{/if}
		</span>
		<button class="btn icon" type="button" aria-label="방 목록 새로고침" title="새로고침" onclick={() => load(true)}>
			<Icon name="refresh" size="1.25rem" />
		</button>
	</div>
</div>
<p class="msg" role="status">{shownMsg}</p>

<section aria-label="방 목록">
	{#if list.state === 'loading'}
		<div class="list-state row" role="status"><span class="spin" aria-hidden="true"></span>방 목록을 불러오는 중입니다.</div>
	{:else if list.state === 'error'}
		<div class="list-state" role="alert">
			<p class="t">서버에 연결할 수 없습니다</p>
			<p class="note">{dev ? '개발 서버에는 방 목록이 없습니다.' : '목록을 다시 불러오는 중입니다.'}</p>
		</div>
	{:else if list.rooms.length === 0}
		<div class="list-state">
			<p class="t">열린 방이 없습니다.</p>
			<p class="note">방 만들기로 첫 방을 열어 보세요.</p>
		</div>
	{:else}
		<ul class="rooms">
			{#each list.rooms as r (r.code)}
				{@const tag = tagOf(r)}
				{@const can = nameOk && tag === 'wait'}
				<li class="rrow a-drop" class:can class:locked={tag !== 'wait'}>
					<div class="main">
						<div class="ln1">
							<span class="c-code">{r.code}</span>
							<span class="c-host">
								<svg class="crown" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 18h18l1-11-5.5 4.5L12 4 7.5 11.5 2 7z" /></svg>
								<span class="sr">방장 </span>{r.host || '방장 없음'}
							</span>
						</div>
						<ul class="tags" aria-label="방 설정">
							{#each tagsOf(r) as t (t.text)}
								<li class="tg" class:strong={t.strong}>{t.text}</li>
							{/each}
						</ul>
					</div>
					<div class="c-n">
						<span class="num">{r.players}/{r.max}<span class="sr">명</span></span>
						<span class="dots" aria-hidden="true">
							{#each { length: r.max } as _, i (i)}<span class="dot" class:on={i < r.players}></span>{/each}
						</span>
					</div>
					<span class="stag {tag}">{TAG_LABEL[tag]}</span>
					<button class="btn join" type="button" disabled={!can} onclick={() => joinFromList(r)}>
						입장<span class="sr"> {r.code} 방{TAG_REASON[tag] ? `. ${TAG_REASON[tag]}` : ''}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
</div>

<style>
	/* 1280px에서 열 사이가 벌어져 행을 눈으로 따라가기 어려웠다. 머리줄·툴바·목록이 같은 폭을 쓴다 */
	.lobby {
		max-width: 60rem;
		margin: 0 auto;
	}
	.page-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
		padding-right: 4.5rem;
	}
	h1 {
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 700;
	}
	.nickedit {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.nickedit .input {
		width: 9rem;
	}
	.dev {
		margin-bottom: 1rem;
		padding: 0.625rem 0.875rem;
		border: 1px dashed var(--muted);
		border-radius: 0.375rem;
		font-size: 0.875rem;
	}
	code {
		font-weight: 700;
	}
	/* DOM은 모바일의 시각 순서(방 만들기, 코드, 목록 정보)를 따르고, 데스크톱 배치는 row-reverse로 뒤집어 만든다. Tab 순서가 화면과 어긋나지 않게 하려는 것이다. */
	.toolbar {
		display: flex;
		flex-direction: row-reverse;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		margin-bottom: 0.25rem;
	}
	.tb-info {
		display: flex;
		align-items: center;
		min-height: 44px;
		gap: 0.5rem;
	}
	.tb-count {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0 0.75rem;
	}
	.tb-count b {
		font-size: 1rem;
	}
	.tb-split {
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}
	.tb-act {
		display: flex;
		flex-direction: row-reverse;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.tb-codebox {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.tb-code {
		display: flex;
		gap: 0.5rem;
	}
	.tb-code .input {
		width: 11rem;
	}
	.msg {
		min-height: 1.25rem;
		margin-bottom: 0.5rem;
		font-size: 0.8rem;
	}
	.rooms {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.list-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		text-align: center;
	}
	.list-state .t {
		font-size: 1rem;
		font-weight: 700;
	}
	.list-state.row {
		flex-direction: row;
		font-size: 0.9rem;
	}

	/* 행 전체가 입장 버튼의 ::after로 덮여 있어 어디를 눌러도 버튼 하나만 눌린다. Tab 정지점도 행당 하나다 */
	.rrow {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 5rem 7rem 5.5rem;
		column-gap: 1rem;
		align-items: center;
		padding: 0.875rem 1.25rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
	}
	.rrow.can {
		cursor: pointer;
	}
	.rrow.can:hover {
		background: var(--btn);
	}
	/* 행 배경이 --sel-bg·--key와 거의 같아져 칩 윤곽이 사라지므로 행이 눌릴 상태에서는 칩을 면 색으로 올린다 */
	.rrow.can:is(:hover, :has(.join:focus-visible)) .tg,
	.rrow.can:is(:hover, :has(.join:focus-visible)) .stag.wait {
		background: var(--surface);
		color: var(--text);
	}
	.rrow.can:is(:hover, :has(.join:focus-visible)) .stag.wait {
		color: var(--btn-text);
	}
	.rrow:has(.join:focus-visible) {
		background: var(--btn);
		outline: 2px solid var(--sel-line);
		outline-offset: 2px;
	}
	.main {
		min-width: 0;
	}
	.ln1 {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	.c-code {
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.06em;
	}
	.c-host {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.crown {
		flex: none;
		width: 0.875rem;
		height: 0.875rem;
		color: var(--btn-text);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}
	.tg {
		display: inline-flex;
		align-items: center;
		height: 1.5rem;
		padding: 0 0.5rem;
		border-radius: 0.25rem;
		background: var(--key);
		color: var(--on-key);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.tg.strong {
		font-weight: 700;
	}
	.c-n {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.num {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.dots {
		display: inline-flex;
		gap: 0.25rem;
	}
	.dot {
		box-sizing: border-box;
		width: 0.625rem;
		height: 0.625rem;
		border: 1.5px solid var(--muted);
		border-radius: 50%;
	}
	.dot.on {
		border-color: var(--btn-primary);
		background: var(--btn-primary);
	}
	/* 상태 단어가 행에서 가장 큰 글자다. 입장 불가 행에서도 이 배지는 그대로 둔다 */
	.stag {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		justify-self: start;
		padding: 0.25rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 1.125rem;
		line-height: 1.5rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.stag.wait {
		color: var(--btn-text);
		background: var(--sel-bg);
	}
	.stag.run {
		color: var(--on-key);
		background: var(--key);
	}
	.stag.full {
		padding: calc(0.25rem - 1px) calc(0.75rem - 1px);
		border: 1px solid var(--muted);
		color: var(--text);
	}
	/* 설정 배지는 흐리게 하지 않는다. 다크에서 --key 위 12px 글자가 불투명도 .7이면 3.81:1로 4.5 아래다 */
	.locked .c-code,
	.locked .c-host,
	.locked .c-n {
		opacity: 0.7;
	}
	.rrow .join {
		justify-self: end;
		min-width: 5.5rem;
		box-sizing: border-box;
		border: 2px solid var(--sel-line);
		background: transparent;
		font-size: 0.875rem;
		font-weight: 700;
	}
	.rrow .join:disabled {
		border-color: var(--muted);
		color: var(--muted);
	}
	.rrow .join::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	@supports selector(:has(*)) {
		.rrow .join:focus-visible {
			outline: none;
		}
	}

	/* 900px 미만: 방 만들기가 맨 위, 코드 입력이 그 아래. 행은 한 열 카드로 쌓는다 */
	@media (max-width: 899.98px) {
		.page-head {
			flex-wrap: nowrap;
			gap: 0.5rem;
		}
		.page-head.editing {
			flex-wrap: wrap;
		}
		.page-head h1 {
			flex: 1 1 auto;
			min-width: 0;
			white-space: nowrap;
		}
		.page-head .bk {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.page-head :global(.btn.chip) {
			flex: 0 1 auto;
			min-width: 0;
			max-width: 7.5rem;
		}
		.page-head .nm {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.tb-act {
			flex-direction: column;
			align-items: stretch;
		}
		.tb-act > .btn {
			width: 100%;
			min-height: 48px;
		}
		.tb-code .input {
			flex: 1 1 auto;
			width: auto;
		}
		.tb-info {
			justify-content: space-between;
		}
		.rooms {
			gap: 0.75rem;
		}
		.rrow {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'code tag' 'host n' 'tags tags' 'act act';
			row-gap: 0.5rem;
			padding: 0.75rem 0.875rem;
		}
		.main,
		.ln1 {
			display: contents;
		}
		.c-code {
			grid-area: code;
		}
		.c-host {
			grid-area: host;
		}
		.tags {
			grid-area: tags;
			margin-top: 0;
		}
		.c-n {
			grid-area: n;
			flex-direction: row-reverse;
			align-items: center;
			gap: 0.5rem;
		}
		.num {
			font-size: 1.125rem;
		}
		.stag {
			grid-area: tag;
			justify-self: end;
			font-size: 1rem;
		}
		.rrow .join {
			grid-area: act;
			justify-self: stretch;
		}
	}
</style>
