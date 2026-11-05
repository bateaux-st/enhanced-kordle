// 재촉 알림의 소리·진동. 오디오는 사용자 입력 뒤에만 열리므로 첫 입력 때 미리 컨텍스트를 만들어 둔다.
import { mpPrefs } from './prefs.svelte';

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
	try {
		const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!ctx && AC) ctx = new AC();
		if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
	} catch {
		/* 오디오를 쓸 수 없는 환경 */
	}
}

/** 660 · 880 · 1175Hz 세 음, 각 120ms. 설정에서 끄면 소리를 내지 않는다. */
export function playNudgeTone(): void {
	if (!mpPrefs.nudgeSound || !ctx) return;
	try {
		const t = ctx.currentTime;
		for (const [hz, at] of [[660, 0], [880, 0.14], [1175, 0.28]]) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = hz;
			gain.gain.setValueAtTime(0.0001, t + at);
			gain.gain.exponentialRampToValueAtTime(0.2, t + at + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.12);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(t + at);
			osc.stop(t + at + 0.14);
		}
	} catch {
		/* 소리는 없어도 된다 */
	}
}

export function vibrate(): void {
	try {
		navigator.vibrate?.([200, 100, 200]);
	} catch {
		/* 진동 미지원(iOS Safari) */
	}
}
