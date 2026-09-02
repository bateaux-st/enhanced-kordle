<script lang="ts">
	import Modal from './Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	// 정답 '바나나'(ㅂㅏㄴㅏㄴㅏ)에 '난방'(ㄴㅏㄴㅂㅏㅇ)을 넣은 결과 — 세 색이 모두 나오는 실제 판정값.
	const ex = [
		{ j: 'ㄴ', m: 'p' },
		{ j: 'ㅏ', m: 'c' },
		{ j: 'ㄴ', m: 'c' },
		{ j: 'ㅂ', m: 'p' },
		{ j: 'ㅏ', m: 'p' },
		{ j: 'ㅇ', m: 'a' }
	];
</script>

<Modal title="이 놀이는?" {onclose}>
	<p>
		한국어 단어를 <b>자모로 풀어쓴</b> 열을 맞히는 놀이입니다. 자모 수(n)는 5~12 사이에서 고르거나 랜덤으로 정합니다.
		단어를 입력하면 칸 색으로 힌트를 줍니다.
	</p>

	<p class="ex-title">정답이 <b>바나나</b>(ㅂㅏㄴㅏㄴㅏ)일 때 <b>난방</b>(ㄴㅏㄴㅂㅏㅇ)을 넣으면:</p>
	<div class="ex">
		{#each ex as c, i (i)}
			<div class="cell {c.m}">{c.j}</div>
		{/each}
	</div>
	<ul>
		<li><span class="dot c"></span> 자모와 자리가 모두 맞음</li>
		<li><span class="dot p"></span> 자모는 있지만 자리가 다름</li>
		<li><span class="dot a"></span> 정답에 없는 자모</li>
	</ul>

	<h3>자모 규칙</h3>
	<ul>
		<li>자모는 <b>24종</b>만 씁니다: ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ</li>
		<li>쌍자음은 같은 자모 둘: <code>까</code> = ㄱㄱㅏ, 겹받침도 둘: <code>닭</code> = ㄷㅏㄹㄱ</li>
		<li>ㅐ ㅔ ㅚ 같은 모음은 풀어 씁니다: <code>개</code> = ㄱㅏㅣ, <code>왜</code> = ㅗㅏㅣ 앞에 ㅇ</li>
		<li>ㅑㅕㅛㅠ는 한 자모입니다</li>
		<li>표준국어대사전에 있는 단어만 입력할 수 있습니다. 띄어쓰기는 무시합니다.</li>
	</ul>

	<h3>키보드</h3>
	<p>화면 키보드 또는 물리 키보드(두벌식 자리, 한/영 상태 무관). Enter로 입력, Backspace로 삭제.</p>
</Modal>

<style>
	p {
		margin: 0 0 0.75rem;
	}
	h3 {
		margin: 1rem 0 0.375rem;
		font-size: 0.95rem;
	}
	ul {
		margin: 0;
		padding-left: 1.1rem;
	}
	li {
		margin: 0.2rem 0;
	}
	code {
		background: var(--slate-200);
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}
	.ex-title {
		margin-bottom: 0.375rem;
	}
	.ex {
		display: flex;
		gap: 4px;
		margin: 0 0 0.75rem;
	}
	.cell {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		font-weight: 700;
		font-size: 1.25rem;
		color: #fff;
	}
	.dot {
		display: inline-block;
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 0.2rem;
		vertical-align: -0.1rem;
		margin-right: 0.25rem;
	}
	.c {
		background: var(--green-500);
	}
	.p {
		background: var(--yellow-500);
	}
	.a {
		background: var(--slate-400);
	}
</style>
