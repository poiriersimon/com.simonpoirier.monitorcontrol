import streamDeck, { action, SingletonAction, WillAppearEvent, KeyDownEvent, SendToPluginEvent } from "@elgato/streamdeck";
import { MonitorService } from "../services/monitor-service";

/**
 * Action that switches a monitor to a specific input source via DDC/CI.
 */
@action({ UUID: "com.simonpoirier.monitorinput.setinput" })
export class SetInput extends SingletonAction<SetInputSettings> {

	override async onWillAppear(ev: WillAppearEvent<SetInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		const label = MonitorService.inputLabel(parseInputSource(settings.inputSource));
		await ev.action.setTitle(label);
	}

	override async onDidReceiveSettings(ev: any): Promise<void> {
		const settings = ev.payload.settings as SetInputSettings;
		const label = MonitorService.inputLabel(parseInputSource(settings.inputSource));
		await ev.action.setTitle(label);
	}

	override async onKeyDown(ev: KeyDownEvent<SetInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		const monitorIndex = settings.monitorIndex ?? 0;
		const inputSource = parseInputSource(settings.inputSource);

		try {
			const ok = await MonitorService.setInput(monitorIndex, inputSource);
			if (ok) {
				const label = MonitorService.inputLabel(inputSource);
				await ev.action.setTitle(`✓ ${label}`);
				streamDeck.logger.info(`Switched monitor ${monitorIndex} to ${label}`);
			} else {
				await ev.action.setTitle("ERR");
				streamDeck.logger.error(`SetVCPFeature failed for monitor ${monitorIndex}, input 0x${inputSource.toString(16)}`);
			}
		} catch (error: any) {
			await ev.action.setTitle("ERR");
			streamDeck.logger.error(`SetInput error: ${error?.message}`);
		}
	}

	/**
	 * Property inspector sends messages here.
	 * Responds to "getMonitors" by enumerating physical monitors and sending the list back.
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<Record<string, string>, SetInputSettings>): Promise<void> {
		const payload = ev.payload as Record<string, string>;
		if (payload.event === "getMonitors") {
			try {
				const monitors = await MonitorService.listMonitors();
				await streamDeck.ui.sendToPropertyInspector({ event: "monitorList", monitors } as any);
			} catch (error: any) {
				streamDeck.logger.error(`Failed to enumerate monitors: ${error?.message}`);
				await streamDeck.ui.sendToPropertyInspector({ event: "monitorList", monitors: [], error: error?.message } as any);
			}
		}
	}
}

function parseInputSource(raw?: string): number {
	if (!raw) return 0x11;
	const trimmed = raw.trim();
	if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
		const val = parseInt(trimmed, 16);
		return isNaN(val) ? 0x11 : val;
	}
	const val = parseInt(trimmed, 10);
	return isNaN(val) ? 0x11 : val;
}

type SetInputSettings = {
	monitorIndex?: number;
	inputSource?: string;
};
