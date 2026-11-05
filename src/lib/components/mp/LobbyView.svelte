<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { listRooms, roomInfo } from '$lib/mp/api';
	import type { RoomSummary } from '$lib/mp/protocol';
	import { CODE_LENGTH, LOBBY_POLL_MS, MAX_PLAYERS, NAME_MAX, normalizeName } from '$lib/mp/rules';
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
	const shownMsg = $derived(code.length > 0 && code.length < CODE_LENGTH ? '방 코드는 6자입니다' : notice || message);

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
		const poll = setInterval(() => document.visibilityState === 'visible' && void load(false), LOBBY_POLL_MS);
		const onvis = () => document.visibilityState === 'visible' && void load(false);
		document.addEventListener('visibilitychange', onvis);
		if (editing) void focusNick();
		return () => {
			clearInterval(poll);
			document.removeEventListener('visibilitychange', onvis);
		};
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
	const TAG_LABEL = { run: '진행 중', full: '가득 참', wait: '대기 중' };

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

	const kindLabel = (k: string) => (k === 'coop' ? '협동' : '경쟁');
	const gameLabel = (g: string) => (g === 'climb' ? '등반' : '단판');
</script>

<div class="page-head">
	<button class="btn" type="button" onclick={onback}><Icon name="back" />뒤로</button>
	<h1>같이 하기</h1>
	<span class="sp"></span>
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
			{#if !nameOk}<span class="note" role="status">닉네임을 입력해 주세요.</span>{/if}
		</form>
	{:else}
		<button class="btn chip" type="button" aria-label="닉네임 수정: {nick}" onclick={startEdit}>
			{nick}<Icon name="edit" />
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
				value={code}
				oninput={(e) => {
					code = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
					e.currentTarget.value = code;
					notice = '';
				}}
			/>
			<button class="btn" type="submit" disabled={!nameOk || code.length !== CODE_LENGTH || busy}>입장</button>
		</form>
	</div>
	<div class="tb-info">
		<span class="tb-count" role="status">공개 방 {list.state === 'ok' ? list.rooms.length : 0}</span>
		<button class="btn icon" type="button" aria-label="방 목록 새로고침" title="새로고침" onclick={() => load(true)}>
			<Icon name="refresh" size="1.25rem" />
		</button>
	</div>
</div>
<p class="msg" role="status">{shownMsg}</p>

<section class="rooms" aria-label="방 목록">
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
			<button class="btn primary big" type="button" disabled={!nameOk || busy} onclick={create}>방 만들기</button>
		</div>
	{:else}
		<div role="table" aria-label="방 목록">
			<div class="rhead" role="row">
				<span role="columnheader">방</span>
				<span role="columnheader">방장</span>
				<span role="columnheader">게임</span>
				<span role="columnheader">인원</span>
				<span role="columnheader"><span class="sr">상태</span></span>
				<span role="columnheader"><span class="sr">입장</span></span>
			</div>
			{#each list.rooms as r (r.code)}
				{@const tag = tagOf(r)}
				<div class="rrow a-drop" role="row">
					<span class="c-code" role="cell">{r.code}</span>
					<span class="c-host" role="cell">{r.host || '방장 없음'}</span>
					<span class="c-game" role="cell">{kindLabel(r.kind)} · {gameLabel(r.game)}</span>
					<span class="c-n" role="cell">{r.players}/{MAX_PLAYERS}명</span>
					<span class="c-tag" role="cell"><span class="bdg {tag}">{TAG_LABEL[tag]}</span></span>
					<span class="c-act" role="cell">
						<button class="btn" type="button" disabled={!nameOk || tag !== 'wait'} onclick={() => joinFromList(r)}>
							입장<span class="sr"> {r.code}</span>
						</button>
					</span>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.page-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 2rem;
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
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		margin-bottom: 0.5rem;
	}
	.tb-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.tb-count {
		font-size: 0.9rem;
		font-weight: 700;
	}
	.tb-act {
		display: flex;
		flex-direction: row-reverse;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
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
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		overflow: hidden;
	}
	.rhead,
	.rrow {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr) minmax(0, 1.3fr) 4.5rem 5.5rem 4.5rem;
		column-gap: 0.75rem;
		align-items: center;
		padding: 0.5rem 1rem;
	}
	.rhead {
		padding-block: 0.625rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--muted);
		border-bottom: 1px solid var(--line);
	}
	.rrow + .rrow {
		border-top: 1px solid var(--line);
	}
	.c-code {
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.06em;
	}
	.c-host,
	.c-game {
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.c-n {
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.c-act {
		display: flex;
		justify-content: flex-end;
	}
	.list-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
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

	/* 900px 미만: 툴바가 두 줄로 감기고 방 만들기가 맨 위, 코드 입력이 그 아래. 목록 행은 카드형으로 쌓는다 */
	@media (max-width: 899.98px) {
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
		}
		.tb-code .input {
			flex: 1 1 auto;
			width: auto;
		}
		.rhead {
			display: none;
		}
		.rrow {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
			grid-template-areas: 'code code act' 'host game act' 'n tag act';
			row-gap: 0.25rem;
			padding-block: 0.75rem;
		}
		.c-code {
			grid-area: code;
		}
		.c-host {
			grid-area: host;
		}
		.c-game {
			grid-area: game;
		}
		.c-n {
			grid-area: n;
		}
		.c-tag {
			grid-area: tag;
		}
		.c-act {
			grid-area: act;
			align-self: center;
		}
	}
</style>
