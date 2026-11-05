<script lang="ts">
	import type { Theme } from '$lib/game.svelte';
	import MpModal from './MpModal.svelte';
	import { mpPrefs } from './prefs.svelte';
	import { unlockAudio, playNudgeTone } from './nudgeFx';

	let {
		theme,
		onthemechange,
		onclearaccount,
		onclose
	}: {
		theme: Theme;
		onthemechange: (t: Theme) => void;
		/** 방 밖에서만 넘긴다. 방 안에서 계정을 지우면 새로고침 복귀가 끊긴다. */
		onclearaccount?: () => void;
		onclose: () => void;
	} = $props();

	const THEMES: { id: Theme; label: string }[] = [
		{ id: 'system', label: '시스템' },
		{ id: 'light', label: '라이트' },
		{ id: 'dark', label: '다크' }
	];

	function toggleSound() {
		mpPrefs.nudgeSound = !mpPrefs.nudgeSound;
		if (mpPrefs.nudgeSound) {
			unlockAudio();
			playNudgeTone();
		}
	}
</script>

<MpModal title="설정" small {onclose}>
	<p class="name" id="theme-label">테마</p>
	<div class="seg" role="group" aria-labelledby="theme-label">
		{#each THEMES as t (t.id)}
			<button class="btn" type="button" aria-pressed={theme === t.id} onclick={() => onthemechange(t.id)}>{t.label}</button>
		{/each}
	</div>

	<button class="sw" type="button" role="switch" aria-checked={mpPrefs.nudgeSound} onclick={toggleSound}>
		<span class="lab">
			<b>재촉 소리</b>
			<span class="note">재촉을 받으면 세 음이 4초마다 납니다. 이 탭을 닫으면 켬으로 돌아옵니다.</span>
		</span>
		<span class="oo">{mpPrefs.nudgeSound ? '켬' : '끔'}</span>
		<span class="trk" aria-hidden="true"><i></i></span>
	</button>

	{#if onclearaccount}
		<div class="acct">
			<p class="note">이 브라우저에 저장된 닉네임과 임시 계정을 지웁니다.</p>
			<button class="btn" type="button" onclick={() => { onclearaccount(); onclose(); }}>임시 계정 지우기</button>
		</div>
	{/if}
</MpModal>

<style>
	.name {
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		font-weight: 700;
	}
	.seg {
		display: flex;
		gap: 0.5rem;
	}
	.seg .btn {
		flex: 1 1 0;
		font-size: 0.875rem;
	}
	.sw {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 44px;
		margin-top: 1rem;
		padding: 0.75rem 0;
		text-align: left;
		border-top: 1px solid var(--line);
	}
	.lab {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.lab b {
		font-size: 0.875rem;
	}
	.oo {
		min-width: 1.5rem;
		text-align: right;
		font-size: 0.8rem;
		font-weight: 700;
	}
	.trk {
		position: relative;
		flex: none;
		width: 2.75rem;
		height: 1.5rem;
		border-radius: 9999px;
		background: var(--switch-off);
		transition: background var(--mo-pop);
	}
	.trk i {
		position: absolute;
		top: 0.1875rem;
		left: 0.1875rem;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: var(--on-tile);
		transition: transform var(--mo-pop);
	}
	.sw[aria-checked='true'] .trk {
		background: var(--btn-primary);
	}
	.sw[aria-checked='true'] .trk i {
		transform: translateX(1.25rem);
	}
	.acct {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
	}
</style>
