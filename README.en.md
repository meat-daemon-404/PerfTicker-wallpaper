# PerfTicker Wallpaper Edition 🖥️⚡ (English Guide)

[简体中文文档](./README.md) · [Wallpaper Architecture Deep-Dive](./docs/WALLPAPER-ARCHITECTURE.md) · [Changelog](./CHANGELOG.md)

**PerfTicker-wallpaper** is a dual-surface hardware telemetry and real-time salary/revenue ticker for Windows:
1. **Read-Only Wallpaper Surface (`wallpaper/`)**: A full-screen HTML5 Canvas project for **Wallpaper Engine** that renders live CPU, GPU, RAM, temperature, and real-time income metrics on your desktop background with zero window-layer conflicts.
2. **Native C# WinForms Control Console & Headless Sensor Bridge (`PerfTicker/`)**: A lightweight native `.NET` tray application providing a loopback HTTP + WebSocket (`/ws`) telemetry bridge (`Bridge.cs`), a `372×214` desktop mini-gadget (`GadgetForm`), a `Ctrl+Alt+P` global hotkey, and a headless `--sensor` daemon mode.

---

## Architecture Highlights

- **Why a Split Bridge + Web Wallpaper Architecture?**
  - Traditional Win32 `Progman` / `WorkerW` child-window injection (`SetParent`) collides with Wallpaper Engine and Windows 11 24H2 desktop compositing, while `WS_EX_LAYERED` color-key windows cannot simultaneously allow desktop icon clicks and panel interactions.
  - By decoupling hardware collection (`PerfTicker.exe --sensor` hosting a loopback WebSocket/HTTP bridge on `127.0.0.1`) from the Wallpaper Engine Web Canvas renderer (`wallpaper/index.html`), the wallpaper stays conflict-free while `Ctrl+Alt+P` summons the interactive native console on demand.

---

## Quick Start

1. **Build or Launch the Sensor Host**:
   ```powershell
   # Standard mode (Main Panel + Built-in WebSocket Bridge + Ctrl+Alt+P hotkey)
   PerfTicker.exe

   # Headless tray sensor mode (lowest CPU/RAM footprint)
   PerfTicker.exe --sensor --port 18492 --interval 1000
   ```
2. **Load in Wallpaper Engine**:
   - Open Wallpaper Engine → **Open from File** → select `wallpaper/project.json` (or `wallpaper/index.html`).

---

## License

Released under the [GNU General Public License v3.0](./LICENSE).
