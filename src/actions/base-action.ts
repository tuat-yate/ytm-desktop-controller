import { DidReceiveGlobalSettingsEvent, SingletonAction, streamDeck, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

export type BaseSettings = {
	port: string; // Kept for individual overrides, but global is preferred.
    showArtwork: boolean;
};

export type GlobalSettings = {
    port?: string;
};

export abstract class BaseAction<T extends BaseSettings> extends SingletonAction<T> {

	private imageUpdateInterval: NodeJS.Timeout | undefined;
	private globalSettings: GlobalSettings = {};

	constructor() {
		super();
		streamDeck.settings.getGlobalSettings<GlobalSettings>().then(settings => this.globalSettings = settings || {});
	}

	onDidReceiveGlobalSettings(ev: DidReceiveGlobalSettingsEvent<GlobalSettings>): void {
		this.globalSettings = ev.settings;
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
        const defaultHeaders: Record<string, string> = {
            "Content-Type": "application/json"
        };

        // options.headers の処理を修正
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
                console.warn(`[${this.constructor.name}] Request to ${endpoint} failed: ${response.status} ${response.statusText}`);
            }
            return response;
        } catch (error) {
            console.error(`[${this.constructor.name}] Request error (${endpoint}):`, error);
            throw error;
        }
    }

    protected async get(port: string, endpoint: string): Promise<any> {
        const response = await this.request(port, endpoint, { method: "GET" });
        if (response.ok) {
            return response.json();
        }
        return null;
    }

    protected async post(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "POST",
            body: body ? JSON.stringify(body) : undefined
        });
    }

    protected async patch(port: string, endpoint: string, body?: any): Promise<Response> {
        return this.request(port, endpoint, {
            method: "PATCH",
            body: body ? JSON.stringify(body) : undefined
        });
    }

	private async updateImage(ev: WillAppearEvent<T>) {
		const settings = ev.payload.settings;
		const showArtwork = !!settings.showArtwork;
		if (!showArtwork) {
			ev.action.setImage(undefined);
			return;
		}

		try {
			const port = this.getPort(settings);

			const songInfo = await this.get(port, "/song");
            
            // if paused, clear image
            if (!songInfo || songInfo.isPaused || !songInfo.imageSrc) {
				ev.action.setImage(undefined);
				return;
			}

			const coverUrl = songInfo.imageSrc;
			const res = await fetch(coverUrl);

			const blob = await res.blob();
			const arrayBuffer = await blob.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const base64 = buffer.toString("base64");
			const image = `data:${blob.type};base64,${base64}`;

			await ev.action.setImage(image);
		} catch (error) {
			console.error("Error updating image:", error);
			ev.action.setImage(undefined);
		}
	}

    override async onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
		this.imageUpdateInterval = setInterval(() => this.updateImage(ev), 1000);
	}

	override async onWillDisappear(
		ev: WillDisappearEvent<T>
	): Promise<void> {
		if (this.imageUpdateInterval) {
			clearInterval(this.imageUpdateInterval);
		}
	}
    
}
