import { action, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

type TrackSettings = BaseSettings & {
	videoId: string;
	forcePlay: boolean;
};

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.add-track-to-queue" })
export class AddTrackToQueueAction extends BaseAction<TrackSettings> {
	override async onKeyDown(ev: KeyDownEvent<TrackSettings>): Promise<void> {
		console.log("Button pressed. Adding track to queue...");
		try {
			// 設定読み込み
			const settings = ev.payload.settings;
			const port = this.getPort(settings);
			const videoId = settings.videoId;
			const forcePlay = !!settings.forcePlay;

			if (!videoId) {
				console.warn("Video ID is not configured.");
				return;
			}
			
			const queueData = await this.get(port, "/queue");
			const isQueueBlank = queueData && Array.isArray(queueData.items) ? queueData.items.length === 0 : true;

			if (forcePlay) {
				// キューの最後尾までスキップ
				await this.jumpLastQueue(port);
			}
			
			try {
				await this.post(port, "/queue", { videoId: videoId });
			} catch (reqError) {
				// BaseActionでログが出力されるため、ここでは何もしない
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
			console.error("Error adding track to queue:", error);
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
}
