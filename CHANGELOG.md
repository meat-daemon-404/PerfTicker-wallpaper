# Changelog

All notable changes to **PerfTicker-wallpaper** (`meat-daemon-404/PerfTicker-wallpaper`) are documented in this file.

## [1.6.0] - 2026-11-03

### Added
- **Loopback HTTP & WebSocket Dual-Channel Data Bridge (`PerfTicker/Bridge.cs`)**: Added zero-allocation local telemetry bridge serving live hardware metrics and revenue counters over HTTP JSON and WebSocket (`/ws`), backed by a headless `SensorCore`.
- **Headless Sensor Daemon Mode (`Program.cs`)**: Added `--sensor` CLI mode (`--port`, `--interval`) for ultra-low-overhead system tray background telemetry without spawning the main GDI+ form.
- **Global Hotkey Wakeup (`AppForm.cs`, `Native.cs`)**: Added `Ctrl+Alt+P` global hotkey registration to summon or toggle the native control console from anywhere.
- **Wallpaper Engine Web Project (`wallpaper/`)**: Full-screen HTML5 Canvas wallpaper replica with automatic WebSocket streaming and HTTP polling fallback, plus architectural post-mortem (`docs/WALLPAPER-ARCHITECTURE.md`).

## [1.5.0] - 2026-11-02

### Added
- **Desktop Mini Gadget (`GadgetForm`)**: Added a draggable `372×214` desktop widget displaying large CPU/GPU readouts, sparkline trends, memory/temperature telemetry, and live revenue ticker without occupying the taskbar or `Alt+Tab` switcher (`F9` toggle).

## [1.4.2] - 2026-11-02

### Changed
- **Layered Window + ColorKey Transparency**: Replaced `Progman` child parenting with `WS_EX_LAYERED` + `LWA_COLORKEY` click-through margins and a ~7 FPS power-saving redraw budget.

## [1.4.1] - 2026-11-02

### Added
- Initial `DesktopHost` (`SetParent` under `SHELLDLL_DefView`) and floating `WallBar` control strip.
