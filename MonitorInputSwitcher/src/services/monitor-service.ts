import { spawn } from "node:child_process";

/**
 * C# source inlined into PowerShell via Add-Type.
 * Wraps the Windows dxva2.dll DDC/CI API for monitor enumeration and VCP control.
 */
const DDCCI_SETUP = `
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DdcCi {
    public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, IntPtr rect, IntPtr data);

    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    [DllImport("dxva2.dll", SetLastError = true)]
    public static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMon, out uint count);

    [DllImport("dxva2.dll", SetLastError = true)]
    public static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMon, uint count, [Out] PHYSICAL_MONITOR[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    public static extern bool DestroyPhysicalMonitor(IntPtr hMon);

    [DllImport("dxva2.dll", SetLastError = true)]
    public static extern bool SetVCPFeature(IntPtr hMon, byte code, uint value);

    [DllImport("dxva2.dll", SetLastError = true)]
    public static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr hMon, byte code, IntPtr pvct, out uint current, out uint max);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX lpmi);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int left; public int top; public int right; public int bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAY_DEVICE {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PHYSICAL_MONITOR {
        public IntPtr hPhysicalMonitor;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szPhysicalMonitorDescription;
    }

    public static List<Dictionary<string, object>> ListMonitors() {
        var result = new List<Dictionary<string, object>>();
        int idx = 0;
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMon, hdc, rect, data) => {
            string adapter = "";
            MONITORINFOEX mi = new MONITORINFOEX();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
            if (GetMonitorInfo(hMon, ref mi)) { adapter = mi.szDevice ?? ""; }

            uint count;
            if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out count) && count > 0) {
                var arr = new PHYSICAL_MONITOR[count];
                if (GetPhysicalMonitorsFromHMONITOR(hMon, count, arr)) {
                    int p = 0;
                    foreach (var m in arr) {
                        string deviceId = "";
                        if (!string.IsNullOrEmpty(adapter)) {
                            DISPLAY_DEVICE dd = new DISPLAY_DEVICE();
                            dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                            // 0x00000001 = EDD_GET_DEVICE_INTERFACE_NAME -> stable interface path
                            if (EnumDisplayDevices(adapter, (uint)p, ref dd, 0x00000001)) {
                                deviceId = dd.DeviceID ?? "";
                            }
                        }
                        var d = new Dictionary<string, object>();
                        d["index"] = idx++;
                        d["description"] = m.szPhysicalMonitorDescription ?? "";
                        d["deviceId"] = deviceId;
                        d["deviceName"] = adapter;
                        result.Add(d);
                        DestroyPhysicalMonitor(m.hPhysicalMonitor);
                        p++;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static bool SetInput(int monitorIndex, byte inputSource) {
        int idx = 0;
        bool success = false;
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMon, hdc, rect, data) => {
            uint count;
            if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out count) && count > 0) {
                var arr = new PHYSICAL_MONITOR[count];
                if (GetPhysicalMonitorsFromHMONITOR(hMon, count, arr)) {
                    foreach (var m in arr) {
                        if (idx == monitorIndex) {
                            success = SetVCPFeature(m.hPhysicalMonitor, 0x60, inputSource);
                        }
                        DestroyPhysicalMonitor(m.hPhysicalMonitor);
                        idx++;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return success;
    }

    public static int GetInput(int monitorIndex) {
        int idx = 0;
        int current = -1;
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMon, hdc, rect, data) => {
            uint count;
            if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out count) && count > 0) {
                var arr = new PHYSICAL_MONITOR[count];
                if (GetPhysicalMonitorsFromHMONITOR(hMon, count, arr)) {
                    foreach (var m in arr) {
                        if (idx == monitorIndex) {
                            uint cur, max;
                            if (GetVCPFeatureAndVCPFeatureReply(m.hPhysicalMonitor, 0x60, IntPtr.Zero, out cur, out max)) {
                                current = (int)cur;
                            }
                        }
                        DestroyPhysicalMonitor(m.hPhysicalMonitor);
                        idx++;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return current;
    }
}
"@ -Language CSharp
`;

/**
 * PowerShell that runs the C# enumeration and merges in the real monitor model
 * name from the EDID (WMI WmiMonitorID), correlated by device interface path.
 * Backslashes are produced via [char]92 to avoid escaping issues in this template.
 */
const ENRICH_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$bs = [char]92
$hash = [char]35
$mons = [DdcCi]::ListMonitors()

function Convert-MonChars($arr) {
  if (-not $arr) { return "" }
  -join ($arr | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ })
}

$map = @{}
try {
  $ids = Get-CimInstance -Namespace ("root" + $bs + "wmi") -ClassName WmiMonitorID -ErrorAction SilentlyContinue
  foreach ($id in $ids) {
    $name = Convert-MonChars $id.UserFriendlyName
    $manu = Convert-MonChars $id.ManufacturerName
    $prod = Convert-MonChars $id.ProductCodeID
    $serial = Convert-MonChars $id.SerialNumberID
    if ($name) { $model = $name } else { $model = (("$manu $prod").Trim()) }
    $inst = [string]$id.InstanceName
    if ($inst) {
      $ip = $inst.Split($bs)
      if ($ip.Count -ge 3) {
        $ckey = ($ip[1] + $bs + $ip[2]) -replace ('_' + $bs + 'd+$'), ''
        $map[$ckey.ToUpperInvariant()] = @{ model = $model; serial = $serial }
      }
    }
  }
} catch {}

foreach ($m in $mons) {
  $model = ""
  $serial = ""
  $hw = ""
  $devId = [string]$m['deviceId']
  if ($devId) {
    $dp = $devId.Split($hash)
    if ($dp.Count -ge 3) {
      $hw = $dp[1]
      $ckey = ($dp[1] + $bs + $dp[2]).ToUpperInvariant()
      if ($map.ContainsKey($ckey)) {
        $model = $map[$ckey].model
        $serial = $map[$ckey].serial
      }
    }
  }
  $m['model'] = $model
  $m['serial'] = $serial
  $m['hardwareId'] = $hw
  if ($serial) { $stableKey = ($hw + $hash + $serial) } else { $stableKey = $hw }
  $m['key'] = $stableKey.ToUpperInvariant()
}

$mons | ConvertTo-Json -Compress
`;

export interface MonitorInfo {
	[key: string]: unknown;
	index: number;
	description: string;
	deviceId?: string;
	deviceName?: string;
	model?: string;
	serial?: string;
	hardwareId?: string;
	/** Stable identity across reboots: hardwareId[#serial]. */
	key?: string;
}

export interface MonitorSelectionSettings {
	monitorIndex?: number;
	monitorDescription?: string;
	monitorId?: string;
	/** Stable identity across reboots: hardwareId[#serial]. */
	monitorKey?: string;
}

/**
 * Known DDC/CI input source codes (VCP 0x60).
 * Exact values may vary by manufacturer; these are the most common for Dell monitors.
 */
export const INPUT_LABELS: Record<number, string> = {
	0x01: "VGA 1",
	0x02: "VGA 2",
	0x03: "DVI 1",
	0x04: "DVI 2",
	0x0f: "DP 1",
	0x10: "DP 2",
	0x11: "HDMI 1",
	0x12: "HDMI 2",
	0x1b: "USB-C",
};

function inputLabel(code: number): string {
	return INPUT_LABELS[code] ?? `0x${code.toString(16).toUpperCase().padStart(2, "0")}`;
}

async function runPowerShell(script: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		ps.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
		ps.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

		ps.on("error", reject);
		ps.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
			} else {
				resolve(stdout.trim());
			}
		});

		ps.stdin.write(script);
		ps.stdin.end();
	});
}

export class MonitorService {
	/**
	 * Enumerate all physical monitors via DDC/CI, enriched with the real model
	 * name read from the monitor EDID (via WMI WmiMonitorID), correlated to each
	 * physical monitor by its device interface path.
	 */
	static async listMonitors(): Promise<MonitorInfo[]> {
		const script = `${DDCCI_SETUP}\n${ENRICH_SCRIPT}`;
		const raw = await runPowerShell(script);
		if (!raw || raw === "") return [];
		const parsed = JSON.parse(raw);
		// ConvertTo-Json returns an object (not array) when there is a single item
		const arr: MonitorInfo[] = Array.isArray(parsed) ? parsed : [parsed];
		return arr;
	}

	/**
	 * Set the input source for a monitor identified by its enumeration index.
	 * Returns true on success.
	 */
	static async setInput(monitorIndex: number, inputSource: number): Promise<boolean> {
		const script = `${DDCCI_SETUP}\n[DdcCi]::SetInput(${monitorIndex}, ${inputSource})`;
		const raw = await runPowerShell(script);
		return raw.toLowerCase() === "true";
	}

	/**
	 * Read the current input source VCP value for a monitor.
	 * Returns -1 if the read fails.
	 */
	static async getInput(monitorIndex: number): Promise<number> {
		const script = `${DDCCI_SETUP}\n[DdcCi]::GetInput(${monitorIndex})`;
		const raw = await runPowerShell(script);
		return parseInt(raw, 10);
	}

    /**
     * Resolve a monitor selection to a current monitor object.
	 * Priority:
	 *   1. Stable EDID key (hardwareId#serial) — survives reboots and UID reorders.
	 *   2. Hardware id alone, disambiguated by saved index when duplicated.
	 *   3. Legacy device interface id.
	 *   4. Description, disambiguated by saved index when duplicated.
	 *   5. Saved enumeration index.
	 *   6. First monitor.
	 */
	static async resolveMonitor(settings: MonitorSelectionSettings): Promise<MonitorInfo | null> {
		const monitors = await this.listMonitors();
		if (monitors.length === 0) return null;

		const fallbackIndex = settings.monitorIndex;

		const wantedKey = settings.monitorKey?.trim().toUpperCase();
		if (wantedKey) {
			const byKey = monitors.find((m) => (m.key || "").toUpperCase() === wantedKey);
			if (byKey) {
				return byKey;
			}
			// Fall back to the hardware id portion (before the serial).
			const wantedHw = wantedKey.split("#")[0];
			if (wantedHw) {
				const hwMatches = monitors.filter((m) => (m.hardwareId || "").toUpperCase() === wantedHw);
				if (hwMatches.length === 1) {
					return hwMatches[0];
				}
				if (hwMatches.length > 1) {
					const byIndex = hwMatches.find((m) => m.index === fallbackIndex);
					return byIndex || hwMatches[0];
				}
			}
		}

		const wantedId = settings.monitorId?.trim();
		if (wantedId) {
			const byId = monitors.find((m) => (m.deviceId || "").trim() === wantedId);
			if (byId) {
				return byId;
			}
		}

		const wantedDescription = settings.monitorDescription?.trim().toLowerCase();
		if (wantedDescription) {
			const matches = monitors.filter((m) => (m.description || "").trim().toLowerCase() === wantedDescription);
			if (matches.length === 1) {
				return matches[0];
			}
			if (matches.length > 1) {
				// Duplicate descriptions (e.g. two "Generic PnP Monitor"): use saved index to disambiguate.
				const byIndex = matches.find((m) => m.index === fallbackIndex);
				if (byIndex) {
					return byIndex;
				}
				return matches[0];
			}
		}

		if (fallbackIndex !== undefined && fallbackIndex !== null) {
			const byIndex = monitors.find((m) => m.index === fallbackIndex);
			if (byIndex) {
				return byIndex;
			}
		}

		return monitors[0];
	}

	/**
	 * Resolve a monitor selection to the current enumeration index.
	 */
	static async resolveMonitorIndex(settings: MonitorSelectionSettings): Promise<number> {
		const monitor = await this.resolveMonitor(settings);
		return monitor?.index ?? 0;
	}

	/**
	 * Short, key-sized display name for a monitor. Prefers the EDID model name,
	 * dropping a leading manufacturer word (e.g. "DELL S3221QS" -> "S3221QS").
	 */
	static monitorLabel(settings: TitleSettings, monitor?: MonitorInfo | null): string {
		const raw = (monitor?.model || settings.monitorModel || settings.monitorDescription || "Monitor").trim();
		if (!raw) return "Monitor";
		const parts = raw.split(/\s+/);
		return parts.length >= 2 ? parts[parts.length - 1] : raw;
	}

	/**
	 * Build a two-line key title: monitor name on the first line and the monitor's
	 * current input source on the second. Reads the live input via DDC/CI.
	 */
	static async buildStatusTitle(settings: TitleSettings, monitor?: MonitorInfo | null): Promise<string> {
		const mon = monitor ?? await this.resolveMonitor(settings);
		const name = this.monitorLabel(settings, mon);
		let input = "—";
		if (mon) {
			const cur = await this.getInput(mon.index);
			if (cur >= 0) input = this.inputLabel(cur);
		}
		return `${name}\n${input}`;
	}

	/** Human-readable label for an input source code. */
	static inputLabel = inputLabel;
}

export interface TitleSettings extends MonitorSelectionSettings {
	monitorModel?: string;
}
