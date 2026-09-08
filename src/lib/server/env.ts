import { error } from '@sveltejs/kit';
import { dict } from './dict';

/** 요청의 platform에서 D1과 시크릿을 꺼낸다. Workers 밖(예: 프리렌더)에서 불리면 500. */
export function ctx(platform: App.Platform | undefined) {
	if (!platform?.env?.DB) error(500, 'platform bindings not available');
	// 시크릿이 없으면 dev 기본값으로 뜬다 — 운영에서는 wrangler secret put KORDLE_SECRET 을 반드시 한다.
	return { db: dict(platform.env.DB), secret: platform.env.KORDLE_SECRET ?? 'dev-only-secret' };
}
