# Changelog

## [1.5.2] - 2026-11-20

### Fixed
- **Safe `PT.fmt` Namespace Initialization (`wallpaper/js/theme.js`)**: Preserved any pre-bound `PT.fmt` formatters when `theme.js` initializes (`var fmt = PT.fmt = PT.fmt || ...`).

### Added
- **Automated Wallpaper & Bridge Contract Verifier (`scripts/verify-wallpaper.mjs`)**: Added automated verification for `wallpaper/project.json`, script imports, and loopback security invariants in `PerfTicker/Bridge.cs`.
