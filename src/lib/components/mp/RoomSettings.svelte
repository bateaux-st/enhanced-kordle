<script lang="ts">
	import type { Settings } from '$lib/mp/protocol';
	import { LENGTH_MAX, LENGTH_MIN, TRIES_MAX, TRIES_MIN } from '$lib/mp/rules';
	import Icon from './Icon.svelte';

	/** summary는 모두에게 보이는 한 줄 요약, edit는 방장의 편집 UI. */
	let {
		settings,
		mode,
		onchange
	}: { settings: Settings; mode: 'summary' | 'edit'; onchange?: (next: Settings) => void } = $props();

	const LENS: Settings['length'][] = ['random', ...Array.from({ length: LENGTH_MAX - LENGTH_MIN + 1 }, (_, i) => LENGTH_MIN + i)];
	const lenIdx = $derived(LENS.indexOf(settings.length));

	let flash = $state('');
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	function set(key: string, patch: Partial<Settings>) {
		flash = key;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = ''), 400);
		onchange?.({ ...settings, ...patch });
	}

	const lenText = (l: Settings['length']) => (l === 'random' ? '랜덤' : `${l}자`);
	const coop = $derived(settings.kind === 'coop');
	const climb = $derived(settings.game === 'climb');
</script>

{#if mode === 'edit'}
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
							<b>투표</b><span class="d">자기 제안에도 투표할 수 있습니다. 20초 안에 정하고, 동률이면 돌림판.</span>
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
			<div class="steps">
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
			</div>
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
	</div>
{:else}
	<dl class="sum">
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
	/* 모달 폭이 넓어서 선택 그룹과 스테퍼를 2열로 둔다. 640px 이하는 한 열 */
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem 2.5rem;
	}
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-self: center;
	}
	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 0.375rem;
		padding: 0;
		font-size: 0.875rem;
		font-weight: 700;
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
		word-break: keep-all;
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
		width: 3.75rem;
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
	/* 데스크톱은 라벨 위, 값 아래로 구분선을 두고, 좁은 화면은 한 줄에 라벨과 값을 담은 칩으로 감긴다 */
	.sum {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 0;
		margin: 0;
	}
	.sum > div {
		padding: 0 1rem;
		border-left: 1px solid var(--line);
	}
	.sum > div:first-child {
		padding-left: 0;
		border-left: 0;
	}
	dt {
		font-size: 0.75rem;
		line-height: 1rem;
		color: var(--muted);
	}
	dd {
		margin: 0.125rem 0 0;
		font-size: 1.125rem;
		line-height: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 640px) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 899.98px) {
		.sum {
			gap: 0.375rem;
		}
		.sum > div,
		.sum > div:first-child {
			display: flex;
			gap: 0.375rem;
			padding: 0.1875rem 0.625rem;
			border: 1px solid var(--muted);
			border-radius: 0.25rem;
		}
		dt,
		dd {
			margin: 0;
			font-size: 0.8125rem;
			line-height: 1.25rem;
		}
		dd {
			font-weight: 500;
		}
	}
</style>
