import { action, KeyDownEvent } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.toggle-play" })
export class TogglePlayAction extends BaseAction<BaseSettings> {
	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		try {
			const port = this.getPort(ev.payload.settings);
			await this.post(port, "/toggle-play");
		} catch (error) {
			console.error("[TogglePlayAction] Error:", error);
		}
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.next" })
export class NextAction extends BaseAction<BaseSettings> {
	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		try {
			const port = this.getPort(ev.payload.settings);
			await this.post(port, "/next");
		} catch (error) {
			console.error("[NextAction] Error:", error);
		}
	}
}

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.previous" })
export class PreviousAction extends BaseAction<BaseSettings> {
	override async onKeyDown(ev: KeyDownEvent<BaseSettings>): Promise<void> {
		try {
			const port = this.getPort(ev.payload.settings);
			await this.post(port, "/previous");
			await this.post(port, "/previous");
		} catch (error) {
			console.error("[PreviousAction] Error:", error);
		}
	}
}
