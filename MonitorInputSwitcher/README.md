# Dell Monitor Input — Stream Deck Plugin

Switch your Dell monitor input source (DP, HDMI, USB-C) directly from a Stream Deck button using DDC/CI, similar to PowerToys Monitor Control.

Built with TypeScript + the [Stream Deck SDK v2](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) (`@elgato/streamdeck`).

## Actions

### Set Monitor Input
Switch a monitor to a **specific** input source on each key press.

### Toggle Monitor Input
**Cycle** through a list of input sources (e.g. DP 1 → USB-C → DP 1 → …) on each key press.

## Input Source Codes (VCP 0x60)

| Code   | Input          |
|--------|----------------|
| `0x0F` | DisplayPort 1  |
| `0x10` | DisplayPort 2  |
| `0x11` | HDMI 1         |
| `0x12` | HDMI 2         |
| `0x1B` | USB-C          |

Custom hex values are supported for monitors with non-standard codes.

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Stream Deck CLI](https://docs.elgato.com/streamdeck/cli/intro): `npm install -g @elgato/cli`
- Stream Deck 6.9+
- DDC/CI enabled in your monitor's OSD

## Build

```powershell
cd MonitorInputSwitcher
npm install
npm run build
```

## Develop (watch mode)

```powershell
npm run watch
```

Changes to `src/` and `manifest.json` are rebuilt automatically and the plugin restarts in Stream Deck.

## Install

Copy the `com.simonpoirier.monitorinput.sdPlugin` folder to:

```
%APPDATA%\Elgato\StreamDeck\Plugins\
```

Then restart Stream Deck, or use:

```powershell
streamdeck link com.simonpoirier.monitorinput.sdPlugin
```

## Property Inspector Features

- **Monitor auto-discovery** — the dropdown lists all connected physical monitors detected via DDC/CI.
- **Refresh** button to re-enumerate monitors.
- **Detect Current Input** (Toggle action) — reads the active VCP 0x60 value.

## Notes

- DDC/CI must be enabled in the monitor OSD.
- Some USB-C/DP docks block DDC/CI pass-through.
- Monitor enumeration and VCP commands are executed via PowerShell + Add-Type (Win32 dxva2.dll). There is a ~1-2 second latency on first press while the C# type compiles; subsequent presses in the same plugin session are fast.
- If multiple monitors are connected, use the monitor dropdown to select the correct one.

