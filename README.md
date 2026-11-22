# PerfTicker Wallpaper (v1.5.2)

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![.NET 8.0 Windows](https://img.shields.io/badge/.NET-8.0--windows-512BD4?logo=dotnet)](https://github.com/meat-daemon-404/PerfTicker-wallpaper)
[![Wallpaper Check](https://img.shields.io/badge/Wallpaper_Contract-48%2F48_Passing-2ea44f)](https://github.com/meat-daemon-404/PerfTicker-wallpaper/blob/main/scripts/verify-wallpaper.mjs)

> **Dual-Surface Hardware Telemetry & Real-Time Salary/Income Ticker for Windows** — Combines a native C#/.NET 8 WinForms floating widget & headless LibreHardwareMonitor telemetry daemon (`PerfTicker/`) with an interactive 60 FPS Wallpaper Engine Web Canvas scene (`wallpaper/`).

## Architecture & Highlights (v1.5.2)

```text
PerfTicker-wallpaper/
├── PerfTicker/                  # C# / .NET 8 WinForms app + LibreHardwareMonitor sensor host
│   ├── Program.cs               # Entrypoint supporting GUI mode + `--sensor` / `--headless` daemon mode
│   ├── TickerForm.cs            # Main floating HUD + `Ctrl+Alt+P` global hotkey & tray controls
│   ├── GadgetForm.cs            # Compact 372x214 desktop mini-gadget (CPU/GPU/RAM/Net + live income)
│   ├── Bridge.cs                # Loopback HTTP + RFC 6455 WebSocket server on 127.0.0.1:51789 (/ & /ws)
│   ├── HardwareMonitor.cs       # CPU/GPU temp, clock, power, load, RAM, disk & network sampler
│   └── PayCalculator.cs         # Millisecond-level real-time salary/revenue accumulator
├── wallpaper/                   # Wallpaper Engine Web Wallpaper project (`project.json` + Canvas HUD)
│   ├── index.html               # Multi-layer hardware dashboard + interactive income card
│   └── js/
│       ├── theme.js             # Shared palettes & `PT.fmt` unified unit formatters
│       ├── sensor-client.js     # Resilient WebSocket (/ws) + HTTP polling bridge client
│       └── app.js               # Canvas charts, particle effects & Wallpaper Engine property bindings
└── scripts/
    └── verify-wallpaper.mjs     # Zero-dependency Node.js static contract & syntax gate (48 checks)
```

## Key Features

- **Unified HTTP + WebSocket Telemetry Bridge (`127.0.0.1:51789`)**: `Bridge.cs` serves both JSON snapshots (`GET /`) and real-time RFC 6455 WebSocket frames (`GET /ws` with `200ms` change-driven push and `1000ms` heartbeat) on the same loopback listener.
- **Headless Daemon & Mini-Gadget Modes**:
  - Launch with `PerfTicker.exe --sensor` (or `--headless`) to run silently in the background feeding Wallpaper Engine with zero window footprint.
  - Press **`Ctrl+Alt+P`** anywhere or use the system tray menu to toggle the **`372×214` Desktop Mini-Gadget (`GadgetForm`)** or main overlay.
- **Zero-Drift Shared Formatter Namespace**: `wallpaper/js/theme.js` exposes `window.PT.fmt` across all Wallpaper Engine render modules so CPU/GPU temperatures, wattages, network throughput, and currency counters remain consistent.

## Build & Verification

```bash
# 1. Verify Wallpaper Engine JS syntax, HTML asset graph, and Bridge.cs contract (48 assertions)
node scripts/verify-wallpaper.mjs

# 2. Build the Windows .NET 8 application (on Windows / .NET 8 SDK)
dotnet build PerfTicker/PerfTicker.csproj -c Release
```

## License

Distributed under the [GNU General Public License v3.0 (GPL-3.0)](LICENSE).
