// 상태가 전부 localStorage에 있어 서버 렌더링이 오히려 hydration 불일치만 만든다.
// 셸 HTML은 빌드 때 프리렌더해 정적 자산으로 낸다 — Worker는 /api 요청에만 실행된다.
export const ssr = false;
export const prerender = true;
