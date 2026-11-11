// 토스트는 한 번에 하나다. 새 토스트가 기존 것을 바로 교체한다(큐 없음).
// top: 화면 위쪽 고정 막대(힌트 투표)가 열려 있을 때 토스트를 그 아래로 내리는 위치(px). 없으면 null.
export const toastState = $state({ text: '', id: 0, out: false, top: null as number | null });

let hideTimer: ReturnType<typeof setTimeout> | undefined;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string): void {
	clearTimeout(hideTimer);
	clearTimeout(clearTimer);
	toastState.text = text;
	toastState.id++;
	toastState.out = false;
	hideTimer = setTimeout(() => (toastState.out = true), 1700);
	clearTimer = setTimeout(() => (toastState.text = ''), 1900);
}
