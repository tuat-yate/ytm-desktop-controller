import { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import YouTubeMusic from "youtube-music-ts-api";
import { BaseAction, BaseSettings } from "./base-action";

type PlaylistSettings = BaseSettings & {
	playlistId: string;
	forcePlay: boolean;
	showArtwork: boolean;
	shuffle: boolean;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-playlist-to-queue" })
export class AddPlaylistToQueueAction extends BaseAction<PlaylistSettings> {
	override async onKeyDown(ev: KeyDownEvent<PlaylistSettings>): Promise<void> {
		console.log("Button pressed. Fetching playlist...");
		try {
			// 設定読み込み
			const settings = ev.payload.settings;
			const port = this.getPort(settings);
			const playlistId = settings.playlistId;
			const forcePlay = !!settings.forcePlay;
			const shuffle = settings.shuffle;

			if (!playlistId) {
				console.warn("Playlist ID is not configured.");
				return;
			}

			const ytm = new YouTubeMusic();
			// ゲストモードでアクセス
			const guest = await ytm.guest();

			
			const queueData = await this.get(port, "/queue");
			const isQueueBlank = queueData && Array.isArray(queueData.items) ? queueData.items.length === 0 : true;

			if (forcePlay) {
				// キューの最後尾までスキップ
				await this.jumpLastQueue(port);
			}
			
			// YouTube Musicのプレイリスト情報を取得
			const playlist = await guest.getPlaylist(playlistId);

			if (!playlist || !playlist.tracks) {
				return;
			}

			// トラックをシャッフル
			let shuffledTracks = playlist.tracks;
			if (shuffle) {
				shuffledTracks = this.shuffleArray(playlist.tracks);
			}

			// 順番にリクエストを送信
			for (const track of shuffledTracks) {
				if (!track.id) continue;

				try {
					await this.post(port, "/queue", { videoId: track.id });
				} catch (reqError) {
					// BaseActionでログが出力されるため、ここでは何もしない
				}
			}

			await new Promise((r) => setTimeout(r, 1000));

			if (forcePlay) {
				await this.post(port, "/next");
				await this.post(port, "/play");
			}
			else if (isQueueBlank) {
				await this.post(port, "/play");
			}

		} catch (error) {
			console.error("Error fetching playlist:", error);
		}
	}

	private async jumpLastQueue(port: string): Promise<number> {
		try {
			console.log("Starting queue stabilization process...");
			let lastCount = -1;
			let currentCount = 0;
			let stableCounter = 0;
			const maxRetries = 50;

			// キューの数が変化しなくなるまで繰り返す
			for (let i = 0; i < maxRetries; i++) {
				
				// 1. 現在のキューの数を取得
				const queueData = await this.get(port, "/queue");
				currentCount = (queueData && Array.isArray(queueData.items)) ? queueData.items.length : 0;

				// 終了判定: 前回と同じ数なら安定とみなす
				if (currentCount === lastCount) {
					stableCounter++;
					if (stableCounter >= 3) {
						break;
					}
				} else {
					stableCounter = 0;
				}

				lastCount = currentCount;

				if (currentCount > 0) {
					// 2. 現在のキューの最終へジャンプ (indexは0始まりなので length - 1)
					const jumpIndex = currentCount - 1;

					await this.patch(port, "/queue", { index: jumpIndex });
					await this.post(port, "/pause");

					// ジャンプ後、読み込みを待つ
					await new Promise((r) => setTimeout(r, 1000));
				} else {
					// キューが空の場合は単に待機
					await new Promise((r) => setTimeout(r, 1000));
				}
			}
			return currentCount;
		} catch (patchError) {
			console.error("Error during queue stabilization:", patchError);
			return 0;
		}
	}

	private shuffleArray<T>(array: T[]): T[] {
		const newArray = [...array];
		for (let i = newArray.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[newArray[i], newArray[j]] = [newArray[j], newArray[i]];
		}
		return newArray;
	}
}
