/** 오늘 날짜(KST, YYYY-MM-DD) — 데일리 계열의 경계는 한국 자정이다. 서버·클라이언트가 같은 계산을 쓴다. */
export function todayKST(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/** 열린 탭의 지난 날짜는 허용하되 잘못된 날짜·미래 문제 요청은 거부한다. */
export function validDailyDay(day: unknown, today = todayKST()): day is string {
	if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return false;
	const parsed = new Date(`${day}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** 현재 시각의 다음 자정이 아니라, 풀던 문제 날짜의 다음 자정까지 센다. */
export function dailySecondsLeft(day: string, now = Date.now()): number {
	const end = Date.parse(`${day}T00:00:00+09:00`) + 86400_000;
	return Math.max(0, Math.ceil((end - now) / 1000));
}
