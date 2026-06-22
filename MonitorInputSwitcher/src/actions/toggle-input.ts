import streamDeck, { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent, SendToPluginEvent } from "@elgato/streamdeck";
import { MonitorService, MonitorInfo } from "../services/monitor-service";

/** How often the key refreshes the monitor's current input source. */
const REFRESH_MS = 60_000;

/**
 * Action that cycles a monitor through a list of input sources on each key press.
 * For example: DP 1 → USB-C → DP 1 → ...
 */
@action({ UUID: "com.simonpoirier.monitorinput.toggleinput" })
export class ToggleInput extends SingletonAction<ToggleInputSettings> {
	/** Per-key interval timers that refresh the displayed current input. */
	private timers = new Map<string, ReturnType<typeof setInterval>>();

	override async onWillAppear(ev: WillAppearEvent<ToggleInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		const monitor = await MonitorService.resolveMonitor(settings);
		await this.ensureMonitorBinding(ev.action, settings, monitor);
		await this.refreshTitle(ev.action, settings, monitor);
		this.startTimer(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<ToggleInputSettings>): void {
		this.stopTimer(ev.action.id);
	}

	override async onDidReceiveSettings(ev: any): Promise<void> {
		const settings = ev.payload.settings as ToggleInputSettings;
		await this.refreshTitle(ev.action, settings);
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
				await ev.action.setTitle("No\nMonitor");
				streamDeck.logger.error("No DDC/CI monitors were detected");
				return;
			}

			await this.ensureMonitorBinding(ev.action, settings, monitor);
			const ok = await MonitorService.setInput(monitor.index, inputs[nextIdx]);
			if (ok) {
				const label = MonitorService.inputLabel(inputs[nextIdx]);
				const newSettings: ToggleInputSettings = { ...settings, currentIndex: nextIdx };
				await ev.action.setSettings(newSettings);
				streamDeck.logger.info(`Toggled ${monitor.model || monitor.description} to ${label} (index ${nextIdx})`);
				await this.refreshTitle(ev.action, newSettings, monitor);
			} else {
				streamDeck.logger.error(`Toggle SetVCPFeature failed for monitor ${monitor.index}`);
				await this.refreshTitle(ev.action, settings, monitor);
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
				const current = await MonitorService.getInput(monitor.index);
				await streamDeck.ui.sendToPropertyInspector({ event: "currentInput", inputSource: current } as any);
			} catch (error: any) {
				streamDeck.logger.error(`Failed to detect input: ${error?.message}`);
			}
		}
	}

	private startTimer(actionObj: any): void {
		this.stopTimer(actionObj.id);
		const timer = setInterval(() => {
			this.refreshTitle(actionObj).catch(() => { /* ignore */ });
		}, REFRESH_MS);
		this.timers.set(actionObj.id, timer);
	}

	private stopTimer(id: string): void {
		const timer = this.timers.get(id);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(id);
		}
	}

	private async refreshTitle(actionObj: any, settings?: ToggleInputSettings, monitor?: MonitorInfo | null): Promise<void> {
		try {
			const s = settings ?? await actionObj.getSettings();
			const title = await MonitorService.buildStatusTitle(s, monitor);
			await actionObj.setTitle(title);
		} catch (error: any) {
			streamDeck.logger.error(`Failed to refresh title: ${error?.message}`);
		}
	}

	private async ensureMonitorBinding(
		actionObj: any,
		settings: ToggleInputSettings,
		resolvedMonitor?: MonitorInfo | null,
	): Promise<void> {
		const monitor = resolvedMonitor ?? await MonitorService.resolveMonitor(settings);
		if (!monitor) return;

		const wantsSave =
			settings.monitorIndex !== monitor.index ||
			(settings.monitorDescription || "") !== (monitor.description || "") ||
			(settings.monitorId || "") !== (monitor.deviceId || "") ||
			(settings.monitorKey || "") !== (monitor.key || "") ||
			(settings.monitorModel || "") !== (monitor.model || "");

		if (wantsSave) {
			const newSettings: ToggleInputSettings = {
				...settings,
				monitorIndex: monitor.index,
				monitorDescription: monitor.description || "",
				monitorId: monitor.deviceId || "",
				monitorKey: monitor.key || "",
				monitorModel: monitor.model || "",
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
	monitorKey?: string;
	monitorModel?: string;
	/** Comma-separated hex values, e.g. "0x0F,0x1B" */
	inputSources?: string;
	/** Persisted index into the inputSources list */
	currentIndex?: number;
};
