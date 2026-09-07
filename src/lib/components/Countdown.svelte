<script lang="ts">
	// 데일리 계열이 끝난 뒤 다음 코스까지 — 경계는 서버와 같은 KST 자정.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	const text = $derived.by(() => {
		const kst = new Date(now + 9 * 3600_000);
		const left = 86400 - (kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds());
		const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
		return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
	});
</script>

<div class="next">다음 단어까지 <b>{text}</b></div>

<style>
	.next {
		margin-top: 0.25rem;
		text-align: center;
		color: var(--slate-500);
		font-size: 0.85rem;
	}
</style>
