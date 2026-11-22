<script lang="ts">
	import { NAME_BAD_CHARS, NAME_MAX, NAME_MIN, nameProblem, normalizeName } from '$lib/mp/rules';
	import MpModal from './MpModal.svelte';

	let {
		lead,
		confirm,
		message = '',
		onsubmit,
		oncancel
	}: {
		lead: string;
		confirm: string;
		/** 서버에서 돌아온 사유(없는 방, 가득 참 등). */
		message?: string;
		onsubmit: (name: string) => void;
		oncancel: () => void;
	} = $props();

	let value = $state('');
	const name = $derived(normalizeName(value));
	const badChars = $derived(nameProblem(value) === 'chars');
	// 쓸 수 없는 문자 안내가 길이 안내보다 먼저다. 문자를 고치기 전에는 글자 수를 채워도 소용없다.
	const short = $derived(!badChars && value.trim().length > 0 && name === null && [...value.trim()].length < NAME_MIN);
</script>

<MpModal title="닉네임" small onclose={oncancel}>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			if (name) onsubmit(name);
		}}
	>
		<p class="lead">{lead}</p>
		<label class="sr" for="nick-modal">닉네임</label>
		<input
			id="nick-modal"
			class="input full"
			type="text"
			placeholder="5~12자, 글자·숫자·기호·이모지"
			maxlength={NAME_MAX}
			autocomplete="off"
			aria-describedby="nick-modal-count nick-modal-msg"
			bind:value
		/>
		<p id="nick-modal-count" class="note count"><span class="sr">글자 수 </span>{[...value].length}/{NAME_MAX}</p>
		<p id="nick-modal-msg" class="note msg" role="status">{badChars ? NAME_BAD_CHARS : short ? `${NAME_MIN}자 이상 입력하세요` : message}</p>
		<div class="two">
			<button class="btn primary big" type="submit" disabled={!name}>{confirm}</button>
			<button class="btn" type="button" onclick={oncancel}>취소</button>
		</div>
	</form>
</MpModal>

<style>
	.lead {
		margin-bottom: 0.75rem;
	}
	.input.full {
		width: 100%;
	}
	.count {
		margin-top: 0.25rem;
		text-align: right;
	}
	.msg {
		min-height: 1.25rem;
		margin: 0.125rem 0 0.75rem;
	}
	.two {
		display: flex;
		gap: 0.5rem;
	}
	.two > .primary {
		flex: 1 1 auto;
	}
</style>
