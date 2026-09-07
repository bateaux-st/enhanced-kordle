/** 오늘 날짜(KST, YYYY-MM-DD) — 데일리 계열의 경계는 한국 자정이다. 서버·클라이언트가 같은 계산을 쓴다. */
export function todayKST(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}
