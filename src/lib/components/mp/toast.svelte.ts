// 토스트는 한 번에 하나다. 새 토스트가 기존 것을 바로 교체한다(큐 없음).
export const toastState = $state({ text: '', id: 0, out: false });

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
