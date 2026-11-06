<script lang="ts">
	import type { Settings } from '$lib/mp/protocol';
	import { LENGTH_MAX, LENGTH_MIN, TRIES_MAX, TRIES_MIN } from '$lib/mp/rules';
	import Icon from './Icon.svelte';

	let {
		settings,
		editable,
		onchange
	}: { settings: Settings; editable: boolean; onchange: (next: Settings) => void } = $props();

	const LENS: Settings['length'][] = ['random', ...Array.from({ length: LENGTH_MAX - LENGTH_MIN + 1 }, (_, i) => LENGTH_MIN + i)];
	const lenIdx = $derived(LENS.indexOf(settings.length));

	let flash = $state('');
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	function set(key: string, patch: Partial<Settings>) {
		flash = key;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = ''), 400);
		onchange({ ...settings, ...patch });
	}

	const lenText = (l: Settings['length']) => (l === 'random' ? '랜덤' : `${l}자`);
	const coop = $derived(settings.kind === 'coop');
	const climb = $derived(settings.game === 'climb');
</script>

{#if editable}
	<div class="stack">
		<div class="pair">
			<fieldset>
				<legend>종류</legend>
				<div class="opts">
					<button class="opt" class:flash={flash === 'kind' && coop} type="button" aria-pressed={coop} onclick={() => set('kind', { kind: 'coop' })}>
						<b>협동</b><span class="d">한 보드에 단어를 제안하고 골라 함께 풉니다.</span>
					</button>
					<button class="opt" class:flash={flash === 'kind' && !coop} type="button" aria-pressed={!coop} onclick={() => set('kind', { kind: 'comp' })}>
						<b>경쟁</b><span class="d">같은 정답을 각자 풉니다.</span>
					</button>
				</div>
			</fieldset>
			{#if coop}
				<fieldset>
					<legend>선택 방식</legend>
					<div class="opts">
						<button class="opt" class:flash={flash === 'pick' && settings.pick === 'vote'} type="button" aria-pressed={settings.pick === 'vote'} onclick={() => set('pick', { pick: 'vote' })}>
							<b>투표</b><span class="d">자기 제안에는 투표할 수 없습니다. 동률이면 돌림판.</span>
						</button>
						<button class="opt" class:flash={flash === 'pick' && settings.pick === 'roulette'} type="button" aria-pressed={settings.pick === 'roulette'} onclick={() => set('pick', { pick: 'roulette' })}>
							<b>돌림판</b><span class="d">제안 중 하나를 무작위로 고릅니다.</span>
						</button>
					</div>
				</fieldset>
			{/if}
			<fieldset>
				<legend>게임</legend>
				<div class="opts">
					<button class="opt" class:flash={flash === 'game' && !climb} type="button" aria-pressed={!climb} onclick={() => set('game', { game: 'single' })}>
						<b>단판</b><span class="d">한 단어.</span>
					</button>
					<button class="opt" class:flash={flash === 'game' && climb} type="button" aria-pressed={climb} onclick={() => set('game', { game: 'climb' })}>
						<b>등반</b><span class="d">시작 길이에서 12자까지 한 자모씩 올라갑니다.</span>
					</button>
				</div>
			</fieldset>
		</div>

		<div class="stepper" class:flash={flash === 'length'}>
			<div class="lab">
				<b id="len-label">{climb ? '시작 길이' : '자모 수'}</b>
				<span class="note">랜덤, 5~12자.</span>
			</div>
			<button class="btn" type="button" aria-label="이전 길이" disabled={lenIdx <= 0} onclick={() => set('length', { length: LENS[lenIdx - 1] })}>
				<Icon name="chevL" size="1.25rem" />
			</button>
			<span class="val" role="status" aria-labelledby="len-label">{lenText(settings.length)}</span>
			<button
				class="btn"
				type="button"
				aria-label="다음 길이"
				disabled={lenIdx >= LENS.length - 1}
				onclick={() => set('length', { length: LENS[lenIdx + 1] })}
			>
				<Icon name="chevR" size="1.25rem" />
			</button>
		</div>

		<div class="stepper" class:flash={flash === 'tries'}>
			<div class="lab">
				<b id="tries-label">시도 횟수</b>
				<span class="note">{TRIES_MIN}~{TRIES_MAX}회.</span>
			</div>
			<button class="btn" type="button" aria-label="시도 횟수 줄이기" disabled={settings.tries <= TRIES_MIN} onclick={() => set('tries', { tries: settings.tries - 1 })}>
				<Icon name="minus" size="1.25rem" />
			</button>
			<span class="val" role="status" aria-labelledby="tries-label">{settings.tries}회</span>
			<button class="btn" type="button" aria-label="시도 횟수 늘리기" disabled={settings.tries >= TRIES_MAX} onclick={() => set('tries', { tries: settings.tries + 1 })}>
				<Icon name="plus" size="1.25rem" />
			</button>
		</div>

		<div>
			<button class="sw" class:flash={flash === 'hard'} type="button" role="switch" aria-checked={settings.hard} onclick={() => set('hard', { hard: !settings.hard })}>
				<span class="lab">
					<b>하드모드</b>
					<span class="note">초록 자모는 그 자리에, 노란 자모는 어디든 반드시 다시 써야 합니다.</span>
				</span>
				<span class="oo">{settings.hard ? '켬' : '끔'}</span>
				<span class="trk" aria-hidden="true"><i></i></span>
			</button>
			<button class="sw" class:flash={flash === 'hints'} type="button" role="switch" aria-checked={settings.hints} onclick={() => set('hints', { hints: !settings.hints })}>
				<span class="lab">
					<b>힌트</b>
					<span class="note">노란 자모 하나의 실제 위치를 알려줍니다. {climb ? `등반 전체에서 ${coop ? '방 전체가' : '한 사람이'} 한 번.` : coop ? '한 판에 한 번.' : '한 사람에 한 번.'}</span>
				</span>
				<span class="oo">{settings.hints ? '켬' : '끔'}</span>
				<span class="trk" aria-hidden="true"><i></i></span>
			</button>
			<button class="sw" class:flash={flash === 'timer'} type="button" role="switch" aria-checked={settings.timer} onclick={() => set('timer', { timer: !settings.timer })}>
				<span class="lab">
					<b>제한 시간</b>
					<span class="note">단판 180초. 등반은 180초에서 스테이지마다 15초씩 줄어 60초까지.</span>
				</span>
				<span class="oo">{settings.timer ? '켬' : '끔'}</span>
				<span class="trk" aria-hidden="true"><i></i></span>
			</button>
		</div>
		<p class="note">설정을 바꾸면 모두의 준비가 풀립니다.</p>
	</div>
{:else}
	<dl class="card sum">
		<div><dt>종류</dt><dd>{coop ? '협동' : '경쟁'}</dd></div>
		{#if coop}<div><dt>선택 방식</dt><dd>{settings.pick === 'vote' ? '투표' : '돌림판'}</dd></div>{/if}
		<div><dt>게임</dt><dd>{climb ? '등반' : '단판'}</dd></div>
		<div><dt>{climb ? '시작 길이' : '자모 수'}</dt><dd>{lenText(settings.length)}</dd></div>
		<div><dt>시도 횟수</dt><dd>{settings.tries}회</dd></div>
		<div><dt>하드모드</dt><dd>{settings.hard ? '켬' : '끔'}</dd></div>
		<div><dt>힌트</dt><dd>{settings.hints ? '켬' : '끔'}</dd></div>
		<div><dt>제한 시간</dt><dd>{settings.timer ? '켬' : '끔'}</dd></div>
	</dl>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.pair {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.opts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.opt {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.125rem;
		min-height: 44px;
		padding: 0.5rem 0.625rem;
		text-align: left;
		border: 2px solid var(--line);
		border-radius: 0.375rem;
		background: transparent;
		color: var(--text);
	}
	.opt .d {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.opt[aria-pressed='true'] {
		border-color: var(--sel-line);
		background: var(--sel-bg);
	}
	.opt[aria-pressed='true'] .d {
		color: var(--text);
	}
	.opt.flash {
		animation: mp-selbg var(--mo-drop) ease-out both;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
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
	.val {
		min-width: 3rem;
		text-align: center;
		font-size: 1rem;
		font-weight: 700;
	}
	.stepper .btn {
		padding: 0;
		width: 44px;
	}
	.stepper.flash,
	.sw.flash {
		animation: mp-selbg var(--mo-drop) ease-out both;
	}
	.sw {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 44px;
		padding: 0.75rem 0;
		text-align: left;
		border-top: 1px solid var(--line);
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
	.sum {
		margin: 0;
	}
	.sum > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
	}
	.sum > div + div {
		border-top: 1px solid var(--line);
	}
	dt {
		font-size: 0.875rem;
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		text-align: right;
	}
</style>
