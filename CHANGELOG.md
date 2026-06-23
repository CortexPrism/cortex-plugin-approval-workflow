# Changelog


## [1.0.4] — 2026-06-22

### Changed

- Migrated to CortexPrism v0.51.0 plugin API
- Renamed `ToolResult` → `ToolCallResult` to match SDK types
- Switched type imports from local `types.ts` to `cortex/plugins` module
- Updated `peerDependencies.cortex` to `>=0.51.0`
- Standardized UI settings: `default` → `defaultValue`, `enum` → `options` for select fields
- All code passes `deno fmt` and `deno lint`
## [Unreleased]

### Added

- Structured logging via ctx.logger in lifecycle hooks

### Changed

- Renamed manifest file from `cortex.json` to `manifest.json` for consistency
  with Cortex standard
- Standardized UI section structure to `ui.settings` format
- Normalized parameter naming: `defaultValue` → `default`, `options` → `enum`
- Added `homepage` field with repository URL
- Added `dependencies` field to manifest

### Fixed

- Fixed incorrect type cast on ctx.config that shadowed the get() method.

## [1.0.2] — 2026-06-15

### Added

- Initial release

## [1.0.2] — 2026-06-17

### Fixed

- Replaced non-existent `cortex/plugins` import with local `types.ts` containing
  inline type definitions
- Removed broken `cortex/plugins` import map from `deno.json`
- Fixed test files with complete mock contexts (`state.delete`, `state.list`,
  `config.get/set/getAll`, `logger`, `host`)
- Rewrote scaffold test files to test actual plugin tools instead of template
  leftovers
- Added `defaultValue` and `default` fields to `ToolParam` type for
  compatibility

## [1.0.1] — 2026-06-15

### Fixed

- Removed `middleware:pre` capability — not yet implemented in Cortex runtime
- Removed `preMiddleware` export from mod.ts
- Added `events` array: subscribes to `tool:pre-execute` for approval gating
- All approval tools continue to work as standalone tools

## [1.0.0] — 2026-06-15

### Added

- Initial plugin scaffold with 6 approval tools and policy engine
