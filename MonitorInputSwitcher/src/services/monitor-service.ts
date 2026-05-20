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
            uint count;
            if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out count) && count > 0) {
                var arr = new PHYSICAL_MONITOR[count];
                if (GetPhysicalMonitorsFromHMONITOR(hMon, count, arr)) {
                    foreach (var m in arr) {
                        var d = new Dictionary<string, object>();
                        d["index"] = idx++;
                        d["description"] = m.szPhysicalMonitorDescription ?? "";
                        result.Add(d);
                        DestroyPhysicalMonitor(m.hPhysicalMonitor);
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

export interface MonitorInfo {
	[key: string]: unknown;
	index: number;
	description: string;
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
	 * Enumerate all physical monitors via DDC/CI.
	 */
	static async listMonitors(): Promise<MonitorInfo[]> {
		const script = `${DDCCI_SETUP}\n[DdcCi]::ListMonitors() | ConvertTo-Json -Compress`;
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

	/** Human-readable label for an input source code. */
	static inputLabel = inputLabel;
}
