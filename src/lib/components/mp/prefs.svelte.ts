// 멀티 화면이 세션 동안만 쓰는 값. 저장하지 않는다(localStorage 키는 mp-session 하나뿐이어야 한다).
export const mpPrefs = $state({
	/** 설정의 "재촉 소리". 새로고침하면 켬으로 돌아온다. */
	nudgeSound: true,
	/** prefers-reduced-motion. JS 연출(재촉 레이어, 알림음 외 효과)이 읽는다. */
	reduced: false
});

export function watchReducedMotion(): () => void {
	const mq = matchMedia('(prefers-reduced-motion: reduce)');
	const sync = () => (mpPrefs.reduced = mq.matches);
	sync();
	mq.addEventListener('change', sync);
	return () => mq.removeEventListener('change', sync);
}
