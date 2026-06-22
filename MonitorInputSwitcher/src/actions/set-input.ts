import streamDeck, { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent, SendToPluginEvent } from "@elgato/streamdeck";
import { MonitorService, MonitorInfo } from "../services/monitor-service";

/** How often the key refreshes the monitor's current input source. */
const REFRESH_MS = 60_000;

/**
 * Action that switches a monitor to a specific input source via DDC/CI.
 */
@action({ UUID: "com.simonpoirier.monitorinput.setinput" })
export class SetInput extends SingletonAction<SetInputSettings> {
	/** Per-key interval timers that refresh the displayed current input. */
	private timers = new Map<string, ReturnType<typeof setInterval>>();

	override async onWillAppear(ev: WillAppearEvent<SetInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		const monitor = await MonitorService.resolveMonitor(settings);
		await this.ensureMonitorBinding(ev.action, settings, monitor);
		await this.refreshTitle(ev.action, settings, monitor);
		this.startTimer(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<SetInputSettings>): void {
		this.stopTimer(ev.action.id);
	}

	override async onDidReceiveSettings(ev: any): Promise<void> {
		const settings = ev.payload.settings as SetInputSettings;
		await this.refreshTitle(ev.action, settings);
	}

	override async onKeyDown(ev: KeyDownEvent<SetInputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		const inputSource = parseInputSource(settings.inputSource);

		try {
			const monitor = await MonitorService.resolveMonitor(settings);
			if (!monitor) {
				await ev.action.setTitle("No\nMonitor");
				streamDeck.logger.error("No DDC/CI monitors were detected");
				return;
			}

			await this.ensureMonitorBinding(ev.action, settings, monitor);
			const ok = await MonitorService.setInput(monitor.index, inputSource);
			if (ok) {
				streamDeck.logger.info(`Switched ${monitor.model || monitor.description} to ${MonitorService.inputLabel(inputSource)}`);
			} else {
				streamDeck.logger.error(`SetVCPFeature failed for monitor ${monitor.index}, input 0x${inputSource.toString(16)}`);
			}
			await this.refreshTitle(ev.action, settings, monitor);
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

	private async refreshTitle(actionObj: any, settings?: SetInputSettings, monitor?: MonitorInfo | null): Promise<void> {
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
		settings: SetInputSettings,
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
			const newSettings: SetInputSettings = {
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
	monitorDescription?: string;
	monitorId?: string;
	monitorKey?: string;
	monitorModel?: string;
	inputSource?: string;
};
