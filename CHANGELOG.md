# Changelog — Human-in-the-Loop Approval Workflow

## [1.0.1] — 2026-06-15

### Fixed
- Removed `middleware:pre` capability — not yet implemented in Cortex runtime
- Removed `preMiddleware` export from mod.ts
- Added `events` array: subscribes to `tool:pre-execute` for approval gating
- All approval tools continue to work as standalone tools

## [1.0.0] — 2026-06-15

### Added
- Initial plugin scaffold with 6 approval tools and policy engine
