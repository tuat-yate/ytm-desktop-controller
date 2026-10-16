import { DidReceiveGlobalSettingsEvent, DidReceiveSettingsEvent, KeyDownEvent, SendToPluginEvent, SingletonAction, streamDeck, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { getNotices } from "../notices";
import { getPlayerFeed, PlayerFeed, SongInfo } from "../player-feed";

export type BaseSettings = {
	port: string; // Kept for individual overrides, but global is preferred.
    showArtwork: boolean;
    showText?: boolean;       // アートワーク上にテキストを重ねるか
    textTemplate?: string;    // {title} {artist} {album} を含むテンプレート
    showProgress?: boolean;   // 下部に再生進捗バーを表示するか
};

export type GlobalSettings = {
    port?: string;
};

// ボタン(コンテキスト)ごとに保持する描画状態。
// SingletonAction はアクション種別ごとに1インスタンスだが、同じアクションを
// 複数キーに配置できるため、context(ev.action.id)単位で状態を分ける。
type RenderState<T extends BaseSettings> = {
	loop?: NodeJS.Timeout;
	loopMs: number;
	settings: T;
	fetching: boolean;
	lastDataAt: number;

	feed?: PlayerFeed;          // 再生状態の受信口(WebSocket)
	feedPort?: string;          // 受信口に使っているポート
	polling: boolean;           // onPoll 実行中か
	lastPollAt: number;

	trackKey?: string;          // 曲の同一性判定キー(videoId 等)
	imageDataUri?: string;      // キャッシュ済みカバー画像(data URI)
	imageDims?: { w: number; h: number };
	isPaused: boolean;

	text: string;               // テンプレート適用後の表示文字列
	textWidth: number;          // 概算ピクセル幅
	needsScroll: boolean;       // ボタン幅に収まらずスクロールが必要か
	scrollOffset: number;       // スクロール位置

	duration: number;           // 曲全体の秒数(songDuration)
	elapsed: number;            // 現在の再生位置(elapsedSeconds)

	lastImageSent?: string;     // 同一画像の再送を避けるため
	showingBlank: boolean;      // 直近で setImage(undefined) 済みか

	offlineSince?: number;      // API に届かなくなった時刻(猶予を見てから警告する)
	showingWarning: boolean;    // 警告画像を出しているか
	statusOnline?: boolean;     // 設定画面に最後に伝えた接続状態
};

// 描画パラメータ
const CANVAS_SIZE = 144;
const FONT_SIZE = 24;
const PAD_X = 8;
const SCROLL_GAP = 40;        // ループ時の文字列同士の間隔
const SCROLL_STEP = 1.4;      // 1フレームあたりの移動量(px)。小さいほどゆっくり(現在 約28px/秒)
const DATA_INTERVAL_MS = 1000;
const RENDER_INTERVAL_MS = 50; // 描画間隔(ms)。小さいほど滑らか(=高負荷)
const AVAIL_WIDTH = CANVAS_SIZE - PAD_X * 2;
const DEFAULT_TEMPLATE = "{title} - {artist}";

// テキストの見た目(自前SVG描画なので自由に調整可能)
const FONT_FAMILY = "'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
const FONT_WEIGHT = 700;
const TEXT_COLOR = "#ffffff";

// 進捗バー
const PROGRESS_HEIGHT = 6;               // バーの高さ(px)
const PROGRESS_FILL = "#1ed760";         // 経過部分(緑系)
const PROGRESS_TRACK = "rgba(255,255,255,0.25)"; // 未経過部分(トラック)

// API に届かない時の警告表示。セットアップ(API Server の有効化)に気付いてもらうため、
// 設定画面を開かない人にも見えるキー上に出す。一時的な切断で点滅しないよう猶予を置く。
const OFFLINE_GRACE_MS = 5000;
const WARNING_IMAGE = `data:image/svg+xml;base64,${Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">`
		+ `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#B03A3A"/>`
		+ `<path d="M72 24 L120 100 H24 Z" fill="none" stroke="#ffffff" stroke-width="10" stroke-linejoin="round"/>`
		+ `<rect x="67" y="50" width="10" height="26" rx="5" fill="#ffffff"/>`
		+ `<circle cx="72" cy="88" r="6" fill="#ffffff"/>`
		+ `<text x="72" y="132" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="24" font-weight="${FONT_WEIGHT}" fill="#ffffff">Setup</text>`
		+ `</svg>`,
).toString("base64")}`;

export abstract class BaseAction<T extends BaseSettings> extends SingletonAction<T> {

	private states = new Map<string, RenderState<T>>();
	private globalSettings: GlobalSettings = {};

	constructor() {
		super();
		streamDeck.settings.getGlobalSettings<GlobalSettings>().then(settings => this.globalSettings = settings || {});
	}

	onDidReceiveGlobalSettings(ev: DidReceiveGlobalSettingsEvent<GlobalSettings>): void {
		this.globalSettings = ev.settings;
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
		const st = this.states.get(ev.action.id);
		if (st) {
			st.settings = ev.payload.settings;
			st.lastDataAt = 0;       // 次tickで即再評価(テンプレート変更などを反映)
			st.lastImageSent = undefined;
		}
	}

	// 設定画面(setup-link.js)からの問い合わせ。接続状態とお知らせを返す。
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, T>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event === "getStatus") {
			await this.sendStatus(ev.action.id);
		}
	}

	// 開いている設定画面に接続状態とお知らせを送る。接続状態はキーの警告表示と同じ判定
	// (猶予を過ぎても届かなければ未接続)にして、キーと設定画面で食い違わないようにする。
	private async sendStatus(actionId: string): Promise<void> {
		const st = this.states.get(actionId);
		const online = !st?.showingWarning;
		if (st) {
			st.statusOnline = online;
		}
		const notices = await getNotices(this.manifestId);
		if (streamDeck.ui.action?.id !== actionId) {
			return; // 取得中に別のキーへ移った
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "status", online, notices });
	}

	// アートワーク表示に関係なく1秒ごとのポーリングを続けるか。
	// 再生中の曲の状態(いいね等)をキーに反映するアクションが true にする。
	protected get needsPolling(): boolean {
		return false;
	}

	// ポーリングのたびに呼ばれるフック(既定では何もしない)。
	protected async onPoll(ev: WillAppearEvent<T>, port: string): Promise<void> {
		// サブクラス用。
	}

    protected getPort(settings: T): string {
        return this.globalSettings.port || settings.port || "26538";
    }

    protected getBaseUrl(port: string): string {
        return `http://localhost:${port}/api/v1`;
    }

    protected async request(
        port: string,
        endpoint: string,
        options: RequestInit = {}
    ): Promise<Response> {
        const url = `${this.getBaseUrl(port)}${endpoint}`;
        const method = options.method ?? "GET";
        const defaultHeaders: Record<string, string> = {
            "Content-Type": "application/json"
        };

        const headers = { ...defaultHeaders };
        if (options.headers) {
             Object.assign(headers, options.headers);
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers: headers
            });

            if (!response.ok) {
                streamDeck.logger.warn(`${method} ${endpoint} failed: ${response.status} ${response.statusText}`);
            }
            return response;
        } catch (error) {
            // アプリ未起動なら繋がらないのが普通なので、通信エラー自体は debug 止まりにする
            // (HTTP として応答がある失敗は上の warn で残る)。
            streamDeck.logger.debug(`${method} ${endpoint} error`, error);
            throw error;
        }
    }

    protected async get(port: string, endpoint: string): Promise<any> {
        const response = await this.request(port, endpoint, { method: "GET" });
        if (!response.ok) {
            return null;
        }
        // 再生中の曲が無いときの /song は 204(本文なし)。json() はそのまま呼ぶと落ちる。
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    protected async post(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "POST",
            body: body ? JSON.stringify(body) : undefined
        });
    }

    protected async delete(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "DELETE",
            body: body ? JSON.stringify(body) : undefined
        });
    }

	// キー押下で API を1回叩くだけのアクション向け。失敗してもキー側で出来ることは
	// ないので、ログに残して握り潰す。
	protected async send(ev: KeyDownEvent<T>, endpoint: string, body?: any): Promise<void> {
		try {
			await this.post(this.getPort(ev.payload.settings), endpoint, body);
		} catch (error) {
			streamDeck.logger.error(`POST ${endpoint} failed`, error);
		}
	}

	// JPEG/PNG のヘッダから画像サイズを読む(画素はデコードしない)。読めなければ null。
	private getImageSize(buf: Buffer, mime: string): { w: number; h: number } | null {
		try {
			if (mime.includes("png")) {
				return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
			}
			// JPEG: SOFマーカー(0xC0〜0xCF、ただしC4/C8/CCを除く)を走査
			let off = 2;
			while (off + 8 < buf.length) {
				if (buf[off] !== 0xff) { off++; continue; }
				const marker = buf[off + 1];
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
				}
				off += 2 + buf.readUInt16BE(off + 2);
			}
		} catch {
			// 解析失敗時は null を返してフォールバックさせる
		}
		return null;
	}

	// 半角/全角をざっくり重み付けして文字列の表示幅を概算する。
	// Node 実行のため canvas measureText が使えず、スクロール要否とループ幅の
	// 判定にはこの概算で十分。
	private measureText(text: string, fontSize: number): number {
		let w = 0;
		for (const ch of text) {
			const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿぀-ヿ㐀-䶿一-鿿]/.test(ch);
			w += wide ? fontSize : fontSize * 0.55;
		}
		return w;
	}

	private escapeXml(s: string): string {
		return s
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;");
	}

	private formatTemplate(tpl: string | undefined, song: any): string {
		const t = tpl && tpl.trim() ? tpl : DEFAULT_TEMPLATE;
		const artist = song.artist ?? song.author ?? "";
		return t
			.replace(/\{title\}/gi, song.title ?? "")
			.replace(/\{artist\}/gi, artist)
			.replace(/\{album\}/gi, song.album ?? "")
			.trim();
	}

	// 再生中の曲を取り込み、曲が変わった時だけカバー画像を取り直す。
	// 曲情報は WebSocket から受け取り、繋がっていない時だけ /song を叩く。
	private async refreshData(st: RenderState<T>, settings: T, feed: PlayerFeed): Promise<void> {
		const songInfo: SongInfo | null = feed.live ? feed.current() : await this.get(this.getPort(settings), "/song");

		// 再生していない / 画像なし は空表示扱い
		if (!songInfo || songInfo.isPaused || !songInfo.imageSrc) {
			st.isPaused = true;
			return;
		}
		st.isPaused = false;

		const key = songInfo.videoId ?? songInfo.imageSrc;
		if (key !== st.trackKey) {
			st.trackKey = key;
			st.scrollOffset = 0;
			const res = await fetch(songInfo.imageSrc);
			const blob = await res.blob();
			const arrayBuffer = await blob.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const base64 = buffer.toString("base64");
			st.imageDataUri = `data:${blob.type};base64,${base64}`;
			st.imageDims = this.getImageSize(buffer, blob.type) ?? { w: CANVAS_SIZE, h: CANVAS_SIZE };
		}

		// テキスト(テンプレートやアーティスト名は曲中でも変わり得るので毎回再評価)
		if (settings.showText) {
			const text = this.formatTemplate(settings.textTemplate, songInfo);
			if (text !== st.text) {
				st.text = text;
				st.textWidth = this.measureText(text, FONT_SIZE);
				st.needsScroll = st.textWidth > AVAIL_WIDTH;
				st.scrollOffset = 0;
			}
		} else {
			st.text = "";
			st.needsScroll = false;
		}

		// 再生位置(進捗バー用)
		st.duration = Number(songInfo.songDuration) || 0;
		st.elapsed = Number(songInfo.elapsedSeconds) || 0;
	}

	// カバー画像(+任意のテキスト)から data URI を生成する。
	private buildImage(st: RenderState<T>, showText: boolean): string {
		const size = CANVAS_SIZE;
		const { w, h } = st.imageDims ?? { w: size, h: size };

		// YouTubeのサムネ等は長方形(16:9/4:3)で、そのまま渡すと正方形ボタンで
		// 引き伸ばされて潰れる。Stream Deckのキー画像レンダラ(QtSvg)は
		// preserveAspectRatio="slice"を無視して明示width/heightに伸縮するため、
		// 自前で「カバー(正方形を覆う)」寸法を計算し、縦横比を保ったまま中央配置する。
		const scale = Math.max(size / w, size / h);
		const dw = w * scale;
		const dh = h * scale;
		const dx = (size - dw) / 2;
		const dy = (size - dh) / 2;

		const showProgress = !!st.settings.showProgress;
		// 進捗バーを出す分だけテキストを上に逃がす
		const bottomReserve = showProgress ? PROGRESS_HEIGHT : 0;

		let defs = "";
		let overlay = "";

		if (showText && st.text) {
			const barTop = size - (FONT_SIZE + 24) - bottomReserve;
			const baseline = size - 13 - bottomReserve;
			const textEsc = this.escapeXml(st.text);
			// 下部に黒の半透明グラデーション帯を敷いて可読性を確保(なめらかにフェード)
			defs = `<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="black" stop-opacity="0"/><stop offset="0.55" stop-color="black" stop-opacity="0.55"/><stop offset="1" stop-color="black" stop-opacity="0.9"/></linearGradient>`;
			overlay += `<rect x="0" y="${barTop}" width="${size}" height="${size - barTop}" fill="url(#grad)"/>`;

			// 縁取り(stroke)は細い字画を内側から削ってしまうため使わない。
			// 代わりに同じ文字を黒半透明で少し下にずらして敷き、影で輪郭を出す。
			const common = `font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" font-weight="${FONT_WEIGHT}" letter-spacing="0.2"`;
			const emit = (x: number, anchor: string): string => {
				const xs = x.toFixed(1);
				return `<text x="${(x + 1).toFixed(1)}" y="${baseline + 1}" text-anchor="${anchor}" ${common} fill="#000000" fill-opacity="0.6">${textEsc}</text>`
					+ `<text x="${xs}" y="${baseline}" text-anchor="${anchor}" ${common} fill="${TEXT_COLOR}">${textEsc}</text>`;
			};
			if (st.needsScroll) {
				const loop = st.textWidth + SCROLL_GAP;
				const off = st.scrollOffset % loop;
				const x1 = PAD_X - off;
				const x2 = x1 + loop;
				overlay += emit(x1, "start");
				overlay += emit(x2, "start");
			} else {
				overlay += emit(size / 2, "middle");
			}
		}

		// 進捗バー(最前面・最下部)。経過分を緑、未経過をトラック色で描く。
		if (showProgress) {
			const ratio = st.duration > 0 ? Math.min(1, Math.max(0, st.elapsed / st.duration)) : 0;
			const y = size - PROGRESS_HEIGHT;
			overlay += `<rect x="0" y="${y}" width="${size}" height="${PROGRESS_HEIGHT}" fill="${PROGRESS_TRACK}"/>`;
			if (ratio > 0) {
				overlay += `<rect x="0" y="${y}" width="${(size * ratio).toFixed(1)}" height="${PROGRESS_HEIGHT}" fill="${PROGRESS_FILL}"/>`;
			}
		}

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
			+ (defs ? `<defs>${defs}</defs>` : "")
			+ `<image href="${st.imageDataUri}" x="${dx}" y="${dy}" width="${dw}" height="${dh}" preserveAspectRatio="none"/>`
			+ overlay
			+ `</svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	}

	// 設定中のポートに対応する受信口を確保する(ポートが変わったら張り替える)。
	private attachFeed(st: RenderState<T>, settings: T): PlayerFeed {
		const port = this.getPort(settings);
		if (st.feedPort !== port) {
			st.feed?.release();
			st.feed = getPlayerFeed(port);
			st.feed.acquire();
			st.feedPort = port;
		}
		return st.feed!;
	}

	/**
	 * API に届いていなければキーへ警告画像を出す。警告中は true を返し、呼び出し側は
	 * 以降の処理(ポーリングや描画)を飛ばす。復帰したら画像を戻して通常描画に任せる。
	 */
	private applyOfflineWarning(ev: WillAppearEvent<T>, st: RenderState<T>, feed: PlayerFeed, now: number): boolean {
		if (!feed.online) {
			st.offlineSince ??= now;
			if (now - st.offlineSince < OFFLINE_GRACE_MS) {
				return false;
			}
			if (!st.showingWarning) {
				ev.action.setImage(WARNING_IMAGE);
				st.showingWarning = true;
				st.showingBlank = false;
				st.lastImageSent = undefined;
			}
			return true;
		}

		st.offlineSince = undefined;
		if (st.showingWarning) {
			st.showingWarning = false;
			// 一旦クリアしておけば、アートワーク表示ならこの後の描画が、
			// 非表示ならステート画像がそのまま出る。
			ev.action.setImage(undefined);
			st.showingBlank = true;
			st.lastImageSent = undefined;
		}
		return false;
	}

	// スクロール要否に合わせてループ間隔を切り替える(必要な時だけ高頻度描画)。
	private applyLoopRate(ev: WillAppearEvent<T>, st: RenderState<T>): void {
		const desired = st.needsScroll && !st.isPaused ? RENDER_INTERVAL_MS : DATA_INTERVAL_MS;
		if (desired !== st.loopMs) {
			this.startLoop(ev, st, desired);
		}
	}

	private startLoop(ev: WillAppearEvent<T>, st: RenderState<T>, ms: number): void {
		if (st.loop) {
			clearInterval(st.loop);
		}
		st.loopMs = ms;
		st.loop = setInterval(() => this.tick(ev), ms);
	}

	private async tick(ev: WillAppearEvent<T>): Promise<void> {
		const st = this.states.get(ev.action.id);
		if (!st) {
			return;
		}
		const settings = st.settings;
		const feed = this.attachFeed(st, settings);
		const now = Date.now();

		// API に届かない状態が続いたらキーに警告を出す(アートワーク表示の有無に関わらず)。
		// 何をしても無反応になるため、セットアップ漏れやアプリ未起動に気付けるようにする。
		const offline = this.applyOfflineWarning(ev, st, feed, now);

		// 設定画面を開いている間に接続状態が変わったら、注意書きの表示を切り替えさせる。
		if (st.statusOnline !== undefined && st.statusOnline === offline && streamDeck.ui.action?.id === ev.action.id) {
			void this.sendStatus(ev.action.id);
		}
		if (offline) {
			return;
		}

		// WebSocket にイベントが無いもの(いいね状態など)は1秒ごとに取りに行く。
		// アートワーク非表示でもキーの状態は更新し続ける。
		if (this.needsPolling && !st.polling && now - st.lastPollAt >= DATA_INTERVAL_MS) {
			st.lastPollAt = now;
			st.polling = true;
			try {
				await this.onPoll(ev, this.getPort(settings));
			} catch (error) {
				streamDeck.logger.debug("Failed to poll player state", error);
			} finally {
				st.polling = false;
			}
		}

		// アートワーク非表示: 一度だけ画像をクリアして終了(以降はステート画像が見える)
		if (!settings.showArtwork) {
			if (!st.showingBlank) {
				ev.action.setImage(undefined);
				st.showingBlank = true;
				st.lastImageSent = undefined;
			}
			return;
		}

		// 曲情報の更新。WebSocket が繋がっていれば毎tick(通信なし)で反映し、
		// 繋がっていない間だけ1秒間隔で /song にフォールバックする。
		if (!st.fetching && (feed.live || now - st.lastDataAt >= DATA_INTERVAL_MS)) {
			st.lastDataAt = now;
			st.fetching = true;
			try {
				await this.refreshData(st, settings, feed);
			} catch (error) {
				streamDeck.logger.debug("Failed to refresh song data", error);
			} finally {
				st.fetching = false;
			}
			this.applyLoopRate(ev, st);
		}

		// 一時停止 / 画像なし は空表示
		if (st.isPaused || !st.imageDataUri) {
			if (!st.showingBlank) {
				ev.action.setImage(undefined);
				st.showingBlank = true;
				st.lastImageSent = undefined;
			}
			return;
		}
		st.showingBlank = false;

		const showText = !!settings.showText;
		if (showText && st.needsScroll) {
			st.scrollOffset += SCROLL_STEP;
		}

		try {
			const image = this.buildImage(st, showText);
			// 静止表示なら同一画像を再送しない(USB帯域節約)。スクロール中は毎フレーム更新。
			if (!st.needsScroll && image === st.lastImageSent) {
				return;
			}
			ev.action.setImage(image);
			st.lastImageSent = image;
		} catch (error) {
			streamDeck.logger.error("Failed to render key image", error);
		}
	}

    override async onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
		const st: RenderState<T> = {
			loopMs: DATA_INTERVAL_MS,
			settings: ev.payload.settings,
			fetching: false,
			lastDataAt: 0,
			isPaused: false,
			text: "",
			textWidth: 0,
			needsScroll: false,
			scrollOffset: 0,
			duration: 0,
			elapsed: 0,
			showingBlank: false,
			polling: false,
			lastPollAt: 0,
			showingWarning: false,
		};
		this.states.set(ev.action.id, st);
		this.attachFeed(st, st.settings);
		this.startLoop(ev, st, DATA_INTERVAL_MS);
	}

	override async onWillDisappear(
		ev: WillDisappearEvent<T>
	): Promise<void> {
		const st = this.states.get(ev.action.id);
		if (st?.loop) {
			clearInterval(st.loop);
		}
		st?.feed?.release();
		this.states.delete(ev.action.id);
	}

}
