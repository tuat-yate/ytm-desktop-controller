import streamDeck from "@elgato/streamdeck";

import { AddTrackToQueueAction } from "./actions/add-track-to-queue";
import { AddPlaylistToQueueAction } from "./actions/add-playlist-to-queue";
import { LikeAction, DislikeAction } from "./actions/rate";
import { TogglePlayAction, NextAction, PreviousAction } from "./actions/playback";
import { ArtworkAction } from "./actions/artwork";
import { GoForwardAction, GoBackAction } from "./actions/go-forward-back";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the increment action.
streamDeck.actions.registerAction(new AddTrackToQueueAction());
streamDeck.actions.registerAction(new AddPlaylistToQueueAction());
streamDeck.actions.registerAction(new LikeAction());
streamDeck.actions.registerAction(new DislikeAction());
streamDeck.actions.registerAction(new TogglePlayAction());
streamDeck.actions.registerAction(new NextAction());
streamDeck.actions.registerAction(new PreviousAction());
streamDeck.actions.registerAction(new ArtworkAction());
streamDeck.actions.registerAction(new GoForwardAction());
streamDeck.actions.registerAction(new GoBackAction());

// Initialize global settings.
streamDeck.settings.getGlobalSettings<{ port?: string }>().then(settings => {
	if (settings === undefined || settings.port === undefined) {
		streamDeck.settings.setGlobalSettings({ port: "26538" });
	}
});

// Finally, connect to the Stream Deck.
streamDeck.connect();
