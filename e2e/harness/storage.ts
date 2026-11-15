import type { Page } from '@playwright/test';

const PREFIX = 'nkordle:';

/**
 * 페이지가 뜨기 전에 localStorage를 채운다. 키는 접두사 없이 쓴다(AGENTS.md의 키 형식).
 * 이미 값이 있으면 덮지 않는다: 새로고침 뒤에도 initScript가 다시 돌기 때문에, 덮으면 앱이 저장한 진행이 지워진다.
 */
export async function seed(page: Page, entries: Record<string, unknown>): Promise<void> {
	await page.addInitScript(
		({ entries, prefix }) => {
			for (const [k, v] of Object.entries(entries)) {
				if (localStorage.getItem(prefix + k) === null) localStorage.setItem(prefix + k, JSON.stringify(v));
			}
		},
		{ entries, prefix: PREFIX }
	);
}

export async function stored<T = unknown>(page: Page, key: string): Promise<T | null> {
	return page.evaluate(
		([k]) => {
			const raw = localStorage.getItem(k);
			return raw === null ? null : JSON.parse(raw);
		},
		[PREFIX + key]
	);
}

export async function storedKeys(page: Page): Promise<string[]> {
	return page.evaluate((prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)), PREFIX);
}
