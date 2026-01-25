import { action } from "@elgato/streamdeck";
import { BaseAction, BaseSettings } from "./base-action";

@action({ UUID: "jp.hayate-kojima.ytm-desktop-controller.artwork" })
export class ArtworkAction extends BaseAction<BaseSettings> {
    
}
