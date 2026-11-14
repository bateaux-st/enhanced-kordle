<script lang="ts">
	import Modal from './Modal.svelte';
	import Countdown from './Countdown.svelte';
	import type { Game } from '$lib/game.svelte';
	import { MAX_N } from '$lib/jamo';
	import { formatTime, totalOf } from '$lib/climbtime';

	// onrestart가 없으면 일일 등반 — 오늘은 끝났으니 다시 시작 대신 다음 코스까지 카운트다운.
	let { game, onrestart, onclose }: { game: Game; onrestart?: () => void; onclose: () => void } = $props();

	const cleared = $derived(game.climbWords.length);
	const complete = $derived(
		(game.config.mode === 'climb-length' || game.config.mode === 'daily-climb') && game.status === 'won' && game.n === MAX_N
	);
	// 스테이지 1이 꼭대기. 길이 상승 모드에서는 5자→12자로 내려가며 자연히 피라미드가 된다.
	// 실패한 스테이지는 쌓지 않는다 — 정답은 토스트·통계에서 따로 공개된다.
	const title = $derived(complete ? `${MAX_N}자 완주!` : cleared ? `스테이지 ${cleared}까지 올랐습니다` : '첫 스테이지에서 멈췄습니다');

	// 시간 기록 이전의 저장본이면 시간을 모르는 스테이지가 있어 총 시간이 null('-')이다.
	const runTotal = $derived(cleared ? totalOf(game.stageTimes.slice(0, cleared)) : null);
	// 옛 최고 스테이지(best:)만 있고 시간 기록이 없으면 스테이지만 보여 준다.
	const bestCard = $derived.by(() => {
		const b = game.climbTime.best;
		if (b && b.stage >= game.bestStage) return { time: formatTime(b.ms), stage: b.stage };
		if (game.bestStage > 0) return { time: '-', stage: game.bestStage };
		return null;
	});
</script>

<Modal title="등반 결과" {onclose}>
	<div class="headline">{title}</div>

	<div class="sums">
		<div class="box">
			<div class="l">이번 총 시간</div>
			<div class="v">{cleared ? formatTime(runTotal) : '-'}</div>
			<div class="s">{cleared ? `스테이지 ${cleared}` : '클리어 없음'}</div>
		</div>
		<div class="box" class:new={game.runBest}>
			<div class="l">최고 기록{#if game.runBest}<span class="tag">새 기록</span>{/if}</div>
			{#if bestCard}
				<div class="v">{bestCard.time}</div>
				<div class="s">스테이지 {bestCard.stage}</div>
			{:else}
				<div class="v none">아직 없음</div>
			{/if}
		</div>
	</div>

	{#if cleared}
		<div class="pw">
			<div class="pyramid" style="--n: {Math.max(...game.climbWords.map((w) => w.length))}">
				{#each game.climbWords as word, i (i)}
					<div class="row" style="animation-delay: {i * 90}ms">
						<div class="tiles">
							{#each [...word] as ch, k (k)}
								<div class="tile">{ch}</div>
							{/each}
						</div>
						<div class="time">
							<span class="sr">스테이지 {i + 1}, </span>
							<b>{formatTime(game.stageTimes[i] ?? null)}</b>
							{#if game.stageBests.includes(i + 1)}
								<span class="best">최고</span><span class="sr"> 기록</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if game.status === 'lost'}
		<div class="stopped">멈춘 스테이지 <b>{game.stage}</b>{#if game.lostMs !== null}{' · ' + formatTime(game.lostMs)}{/if}</div>
		{#if game.answer}
			<div class="answer">멈춘 곳의 정답: <b>{game.answer}</b></div>
		{/if}
	{/if}

	{#if onrestart}
		<button class="restart" onclick={onrestart}>{complete ? '다시 등반' : '처음부터'}</button>
	{:else}
		<Countdown day={game.dailyDay} />
	{/if}
</Modal>

<style>
	.headline {
		font-size: 1.1rem;
		font-weight: 700;
		text-align: center;
		margin-bottom: 0.75rem;
	}
	.sums {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.box {
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		min-width: 0;
	}
	/* 새 기록은 테두리 두께·배경에 더해 '새 기록' 글자로도 구분한다. 배경 위 글자는 --text만 쓴다. */
	.box.new {
		padding: calc(0.625rem - 1px) calc(0.75rem - 1px);
		border: 2px solid var(--sel-line);
		background: var(--sel-bg);
	}
	.l {
		font-size: 0.75rem;
		line-height: 1.25rem;
		color: var(--muted);
	}
	.box.new .l,
	.box.new .s {
		color: var(--text);
	}
	.v {
		font-size: 1.5rem;
		line-height: 1.875rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.v.none {
		font-size: 1.125rem;
		color: var(--muted);
	}
	.s {
		font-size: 0.8125rem;
		line-height: 1.1rem;
	}
	.tag {
		margin-left: 0.375rem;
		padding: 0 0.375rem;
		border-radius: 0.25rem;
		background: var(--btn-primary);
		color: var(--on-tile);
		font-size: 0.6875rem;
		font-weight: 700;
		vertical-align: middle;
	}

	/* 모달 폭을 재서 타일을 줄인다. %는 flex 자식의 shrink-to-fit 폭을 참조해 0이 되므로 컨테이너 쿼리 단위를 쓴다.
	   좌우로 0.5rem씩 넓혀 12자 행과 시간 열이 390px 화면에서도 한 줄에 들어가게 한다. */
	.pw {
		container-type: inline-size;
		margin-inline: -0.5rem;
	}
	.pyramid {
		--tcol: 3.5rem;
		--cgap: 0.5rem;
		--tgap: 2px;
		--tile: min(2.25rem, calc((100cqw - var(--tcol) - var(--cgap) - (var(--n) - 1) * var(--tgap)) / var(--n)));
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	/* 타일은 시간 열을 뺀 폭 안에서 가운데 정렬 — 시간 열이 피라미드 모양을 밀지 않는다. */
	.row {
		display: grid;
		grid-template-columns: 1fr var(--tcol);
		column-gap: var(--cgap);
		align-items: center;
		min-height: 1.75rem;
		animation: drop 0.3s ease-out both;
	}
	.tiles {
		display: flex;
		justify-content: center;
		gap: var(--tgap);
	}
	.tile {
		width: var(--tile);
		height: var(--tile);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--tile-correct);
		color: var(--on-tile);
		border-radius: 0.2rem;
		font-weight: 700;
		font-size: calc(var(--tile) * 0.5);
	}
	.time {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.1;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.time b {
		font-size: 0.875rem;
	}
	.best {
		margin-top: 1px;
		padding: 0 0.3rem;
		border-radius: 0.25rem;
		background: var(--btn-primary);
		color: var(--on-tile);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1rem;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@keyframes drop {
		from {
			transform: translateY(-8px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	.stopped {
		margin-top: 1rem;
		text-align: center;
	}
	.answer {
		margin-top: 0.25rem;
		text-align: center;
	}
	.restart {
		margin-top: 1.25rem;
		width: 100%;
		height: 2.75rem;
		border-radius: 0.375rem;
		background: var(--btn-primary);
		color: #fff;
		font-weight: 700;
		font-size: 1rem;
	}
	.restart:hover {
		background: var(--btn-primary-hover);
	}
</style>
