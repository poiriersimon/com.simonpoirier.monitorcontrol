import streamDeck, { action, SingletonAction, WillAppearEvent, KeyDownEvent, SendToPluginEvent } from "@elgato/streamdeck";
import { MonitorService } from "../services/monitor-service";

/**
 * Action that cycles a monitor through a list of input sources on each key press.
 * For example: DP 1 → USB-C → DP 1 → ...
 */
@action({ UUID: "com.simonpoirier.monitorinput.toggleinput" })
export class ToggleInput extends SingletonAction<ToggleInputSettings> {

	override async onWillAppear(ev: WillAppearEvent<ToggleInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		await this.ensureMonitorBinding(ev.action, settings);
		await this.updateTitle(ev.action, settings);
	}

	override async onDidReceiveSettings(ev: any): Promise<void> {
		const settings = ev.payload.settings as ToggleInputSettings;
		await this.updateTitle(ev.action, settings);
	}

	override async onKeyDown(ev: KeyDownEvent<ToggleInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		const inputs = parseInputList(settings.inputSources);

		if (inputs.length < 2) {
			await ev.action.setTitle("Need\n2+\ninputs");
			return;
		}

		// Determine next input
		let currentIdx = settings.currentIndex ?? 0;
		let nextIdx = (currentIdx + 1) % inputs.length;

		try {
			const monitor = await MonitorService.resolveMonitor(settings);
			if (!monitor) {
				await ev.action.setTitle("ERR");
				streamDeck.logger.error("No DDC/CI monitors were detected");
				return;
			}

			await this.ensureMonitorBinding(ev.action, settings, monitor);
			const monitorIndex = monitor.index;
			const ok = await MonitorService.setInput(monitorIndex, inputs[nextIdx]);
			if (ok) {
				const label = MonitorService.inputLabel(inputs[nextIdx]);
				const newSettings: ToggleInputSettings = { ...settings, currentIndex: nextIdx };
				await ev.action.setSettings(newSettings);
				await ev.action.setTitle(`✓ ${label}`);
				streamDeck.logger.info(`Toggled monitor ${monitorIndex} to ${label} (index ${nextIdx})`);
			} else {
				await ev.action.setTitle("ERR");
				streamDeck.logger.error(`Toggle SetVCPFeature failed for monitor ${monitorIndex}`);
			}
		} catch (error: any) {
			await ev.action.setTitle("ERR");
			streamDeck.logger.error(`ToggleInput error: ${error?.message}`);
		}
	}

	/**
	 * Property inspector sends messages here.
	 * Responds to "getMonitors" with the monitor list and "detectInput" with the current input.
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<Record<string, string>, ToggleInputSettings>): Promise<void> {
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

		if (payload.event === "detectInput") {
			const settings = await ev.action.getSettings();
			try {
				const monitor = await MonitorService.resolveMonitor(settings);
				if (!monitor) {
					await streamDeck.ui.sendToPropertyInspector({ event: "currentInput", inputSource: -1 } as any);
					return;
				}
				await this.ensureMonitorBinding(ev.action, settings, monitor);
				const monitorIndex = monitor.index;
				const current = await MonitorService.getInput(monitorIndex);
				await streamDeck.ui.sendToPropertyInspector({ event: "currentInput", inputSource: current } as any);
			} catch (error: any) {
				streamDeck.logger.error(`Failed to detect input: ${error?.message}`);
			}
		}
	}

	private async updateTitle(actionObj: any, settings: ToggleInputSettings): Promise<void> {
		const inputs = parseInputList(settings.inputSources);
		if (inputs.length === 0) {
			await actionObj.setTitle("Toggle\nInput");
			return;
		}
		const idx = settings.currentIndex ?? 0;
		const safeIdx = idx < inputs.length ? idx : 0;
		const label = MonitorService.inputLabel(inputs[safeIdx]);
		await actionObj.setTitle(label);
	}

	private async ensureMonitorBinding(
		actionObj: any,
		settings: ToggleInputSettings,
		resolvedMonitor?: { index: number; description: string; deviceId?: string },
	): Promise<void> {
		const monitor = resolvedMonitor ?? await MonitorService.resolveMonitor(settings);
		if (!monitor) return;

		const wantsSave =
			settings.monitorIndex !== monitor.index ||
			(settings.monitorDescription || "") !== (monitor.description || "") ||
			(settings.monitorId || "") !== (monitor.deviceId || "");

		if (wantsSave) {
			const newSettings: ToggleInputSettings = {
				...settings,
				monitorIndex: monitor.index,
				monitorDescription: monitor.description || "",
				monitorId: monitor.deviceId || "",
			};
			await actionObj.setSettings(newSettings);
		}
	}
}

/**
 * Parse a comma-separated list of hex input source values.
 * Example: "0x0F,0x1B" → [15, 27]
 */
function parseInputList(raw?: string): number[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => {
			if (s.startsWith("0x") || s.startsWith("0X")) {
				return parseInt(s, 16);
			}
			return parseInt(s, 10);
		})
		.filter((n) => !isNaN(n) && n >= 0 && n <= 255);
}

type ToggleInputSettings = {
	monitorIndex?: number;
	monitorDescription?: string;
	monitorId?: string;
	/** Comma-separated hex values, e.g. "0x0F,0x1B" */
	inputSources?: string;
	/** Persisted index into the inputSources list */
	currentIndex?: number;
};
