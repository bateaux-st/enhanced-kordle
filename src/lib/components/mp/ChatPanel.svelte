<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { MpClient } from '$lib/mp/client.svelte';
	import { CHAT_MAX } from '$lib/mp/rules';

	let {
		client,
		divider = false,
		autofocus = false
	}: {
		client: MpClient;
		/** 열 때 안 읽은 메시지가 있으면 그 앞에 구분선을 그린다. 시트·서랍용(대기실 패널은 늘 보이니 필요 없다). */
		divider?: boolean;
		autofocus?: boolean;
	} = $props();

	// 서버 상한과 같은 코드포인트 기준으로 센다. maxlength는 UTF-16 길이로 세어 이모지가 카운터보다 일찍 막히므로 쓰지 않고,
	// 넘친 글은 입력 때 잘라 낸다. IME 조합 중에는 값을 건드리지 않고 조합이 끝난 뒤에 자른다.
	const COUNT_FROM = 80;
	const id = $props.id();
	let input: HTMLInputElement | undefined = $state();
	let logEl: HTMLElement | undefined = $state();
	// 입력칸 아래에 한 줄로 보이는 안내: 보내기 실패, 속도 제한
	let note = $state('');

	// 열린 순간에 정한다. 열려 있는 동안 새 메시지가 와도 구분선과 숫자는 그대로 둔다.
	const mark = untrack(() => {
		if (!divider) return null;
		const unread = client.chat.filter((l) => !l.system && l.key > client.chatSeen && l.pid !== client.pid);
		return unread.length ? { key: unread[0].key, n: unread.length } : null;
	});

	const hm = (at: number) => {
		const d = new Date(at);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	};
	const count = $derived([...client.chatDraft].length);

	// 보이는 동안 온 메시지는 읽은 것으로 친다.
	$effect(() => {
		void client.chat;
		untrack(() => client.markChatRead());
	});

	// 낭독은 남이 보낸 메시지만 별도 영역이 읽는다. 로그 자체를 라이브로 두면 토스트와 겹치는 입장·퇴장 줄과 내가 보낸 글까지 다시 읽힌다.
	// 열 때 이미 있던 줄은 읽지 않고, 한꺼번에 여러 줄이 오면 마지막 줄만 읽는다.
	let spoken = $state({ n: 0, text: '' });
	let spokenKey = untrack(() => Math.max(0, ...client.chat.map((l) => l.key)));
	$effect(() => {
		const lines = client.chat;
		untrack(() => {
			const last = lines.findLast((l) => !l.system && l.pid !== client.pid && l.key > spokenKey);
			spokenKey = Math.max(spokenKey, ...lines.map((l) => l.key));
			if (last) spoken = { n: spoken.n + 1, text: `${last.name}: ${last.text}` };
		});
	});

	// 맨 아래에 있을 때만 따라 내려간다. 올려서 읽는 중이면 그대로 둔다. 내가 보내면 항상 내려간다.
	let pinned = true;
	function onscroll() {
		if (logEl) pinned = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight <= 24;
	}
	$effect(() => {
		void client.chat;
		if (logEl && pinned) logEl.scrollTop = logEl.scrollHeight;
	});
	onMount(() => {
		// 안 읽은 메시지가 있으면 구분선이 보이게 올려 둔다. 포커스 이동으로 로그가 다시 밀리지 않게 preventScroll을 건다.
		const d = logEl?.querySelector('.unread');
		if (logEl && d) {
			logEl.scrollTop += d.getBoundingClientRect().top - logEl.getBoundingClientRect().top - 8;
			onscroll();
		}
		if (autofocus) input?.focus({ preventScroll: true });
	});

	function clamp() {
		const cps = [...client.chatDraft];
		if (cps.length > CHAT_MAX) client.chatDraft = cps.slice(0, CHAT_MAX).join('');
	}
	function oninput(e: Event) {
		note = '';
		if (!(e as InputEvent).isComposing) clamp();
	}

	let lastSent = '';
	function send() {
		clamp();
		const text = client.chatDraft;
		if (!text.trim()) return;
		if (!client.sendChat(text)) {
			note = '보내지 못했습니다. 다시 시도하세요.';
			return;
		}
		note = '';
		lastSent = text;
		client.chatDraft = '';
		pinned = true;
		input?.focus();
	}

	// 서버가 속도 제한으로 거절하면 글을 돌려 놓는다. 그사이 새로 쓴 글이 있으면 건드리지 않는다.
	let lastErr = untrack(() => client.error?.id ?? 0);
	$effect(() => {
		const e = client.error;
		if (!e || e.id === lastErr) return;
		lastErr = e.id;
		if (e.code !== 'cooldown' || !e.msg.startsWith('채팅')) return;
		// 토스트는 입력칸에서 멀고 키보드에 가릴 수 있어 같은 문구를 입력칸 아래에도 남긴다.
		note = e.msg;
		untrack(() => !client.chatDraft && (client.chatDraft = lastSent));
	});

	function onkeydown(e: KeyboardEvent) {
		// 한글 조합을 확정하는 Enter는 전송이 아니다. 일부 브라우저는 isComposing이 false로 와도 keyCode 229를 준다.
		if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
		e.preventDefault();
		send();
	}
</script>

<div class="chat">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="log" role="log" aria-live="off" aria-label="채팅 기록" tabindex="0" bind:this={logEl} {onscroll}>
		{#each client.chat as l (l.key)}
			{#if mark && l.key === mark.key}
				<div class="unread" role="separator"><span>안 읽은 메시지 {mark.n}개</span></div>
			{/if}
			{#if l.system}
				<p class="sys"><time>{hm(l.at)}</time><span>{l.text}</span></p>
			{:else}
				<div class="msg">
					<p class="meta">
						<b class="nm">{l.name}</b>
						{#if l.pid === client.pid}<span class="bdg me">나</span>{/if}
						<time>{hm(l.at)}</time>
					</p>
					<p class="body">{l.text}</p>
				</div>
			{/if}
		{:else}
			<p class="empty">아직 메시지가 없습니다.</p>
		{/each}
	</div>
	<div class="sr" role="status" aria-atomic="true">{#key spoken.n}{spoken.text}{/key}</div>
	<div class="send">
		<label class="sr" for={id}>채팅 메시지</label>
		<div class="field">
			<input
				{id}
				class="input"
				type="text"
				autocomplete="off"
				placeholder="메시지 입력"
				enterkeyhint="send"
				bind:this={input}
				bind:value={client.chatDraft}
				data-chat-entry={divider ? undefined : ''}
				{oninput}
				oncompositionend={clamp}
				{onkeydown}
			/>
			{#if count > COUNT_FROM}<span class="cnt" class:full={count >= CHAT_MAX} aria-hidden="true">{count}/{CHAT_MAX}</span>{/if}
		</div>
		<button class="btn primary" type="button" onclick={send}>보내기</button>
	</div>
	{#if count > COUNT_FROM}<p class="sr" role="status">{count >= CHAT_MAX ? '글자 수 한도에 닿았습니다' : `${Math.max(0, CHAT_MAX - count)}자 남음`}</p>{/if}
	{#if note}<p class="fail" role="status">{note}</p>{/if}
</div>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}
	/* 메시지는 아래부터 쌓는다. 앞의 빈 칸이 남는 높이를 먹어 적을 때는 입력줄 바로 위에 붙는다 */
	.log {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.75rem 1rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		border-top: 1px solid var(--line);
	}
	.log::before {
		content: '';
		margin-top: auto;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.25rem;
	}
	.nm {
		font-weight: 700;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.meta .bdg.me {
		flex: none;
	}
	time {
		flex: none;
		font-size: 0.75rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.body {
		margin-top: 1px;
		font-size: 0.9rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.sys {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		font-size: 0.8rem;
		line-height: 1.25rem;
		color: var(--muted);
	}
	.sys span {
		overflow-wrap: anywhere;
	}
	.empty {
		margin: auto 0;
		text-align: center;
		font-size: 0.875rem;
		color: var(--muted);
	}
	.unread {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--btn-text);
	}
	.unread::before,
	.unread::after {
		content: '';
		flex: 1 1 0;
		height: 1px;
		background: var(--sel-line);
	}
	.send {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--line);
	}
	.send .btn {
		flex: none;
		min-width: 4.5rem;
		font-size: 0.875rem;
		font-weight: 700;
	}
	.field {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
	}
	/* 글자 수 자리는 처음부터 오른쪽 안쪽에 잡아 두어 카운터가 나타나도 글이 밀리지 않는다 */
	.field .input {
		width: 100%;
		padding-right: 3.75rem;
	}
	.field .input::placeholder {
		color: var(--muted);
		opacity: 1;
	}
	.cnt {
		position: absolute;
		top: 50%;
		right: 0.75rem;
		transform: translateY(-50%);
		font-size: 0.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.cnt.full {
		text-decoration: underline;
	}
	.fail {
		padding: 0 1rem 0.75rem;
		font-size: 0.8rem;
		color: var(--text);
	}
</style>
