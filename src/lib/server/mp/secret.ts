// 임시 계정 토큰 서명 키. 방 생성 라우트(SvelteKit)와 Room DO가 같은 값을 써야 하므로 한 곳에 둔다.
// env.ts와 같은 dev 기본값 — 시크릿이 없으면 로컬에서만 뜬다. 운영은 wrangler secret.
export const mpSecret = (secret: string | undefined): string => secret ?? 'dev-only-secret';
