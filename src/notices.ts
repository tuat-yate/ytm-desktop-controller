import { streamDeck } from "@elgato/streamdeck";

// 設定画面に出すお知らせ。リリースせずに出し入れできるよう、リポジトリの notices.json を読みに行く。
// pear-desktop 側の不具合など、プラグインの更新では直せない問題を利用者に伝えるためのもの。
const NOTICES_URL = "https://raw.githubusercontent.com/tuat-yate/ytm-desktop-controller/main/notices.json";
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

export type Notice = {
	id: string;
	level?: "info" | "warning";
	message: string;            // プレーンテキスト(HTML としては扱わない)
	url?: string;               // 詳細へのリンク(任意)
	actions?: string[];         // 対象アクション(UUID 末尾の "next" など)。省略時は全アクション
};

let cache: { at: number; notices: Notice[] } | undefined;
let pending: Promise<Notice[]> | undefined;

async function load(): Promise<Notice[]> {
	try {
		const response = await fetch(NOTICES_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}
		const body: any = await response.json();
		const notices: Notice[] = Array.isArray(body?.notices)
			? body.notices.filter((n: any) => typeof n?.id === "string" && typeof n?.message === "string")
			: [];
		cache = { at: Date.now(), notices };
		return notices;
	} catch (error) {
		// オフラインなどで取れなければ前回分を使う(無ければ何も出さない)。
		streamDeck.logger.debug("Failed to load notices", error);
		return cache?.notices ?? [];
	}
}

// manifestId のアクションに該当するお知らせを返す。
export async function getNotices(manifestId: string | undefined): Promise<Notice[]> {
	let notices: Notice[];
	if (cache && Date.now() - cache.at < CACHE_MS) {
		notices = cache.notices;
	} else {
		pending ??= load().finally(() => pending = undefined);
		notices = await pending;
	}

	const action = manifestId?.split(".").pop();
	return notices.filter(n => !n.actions || (action !== undefined && n.actions.includes(action)));
}
