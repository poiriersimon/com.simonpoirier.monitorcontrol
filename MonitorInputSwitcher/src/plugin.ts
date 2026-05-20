import streamDeck from "@elgato/streamdeck";

import { SetInput } from "./actions/set-input";
import { ToggleInput } from "./actions/toggle-input";

streamDeck.logger.setLevel("info");

// Register actions
streamDeck.actions.registerAction(new SetInput());
streamDeck.actions.registerAction(new ToggleInput());

// Connect to Stream Deck
streamDeck.connect();
