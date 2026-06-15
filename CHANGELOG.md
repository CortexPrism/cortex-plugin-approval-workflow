# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- N/A

## [1.0.0] — 2026-06-15

### Added
- Initial release of cortex-plugin-approval-workflow
- `approval_request` tool — Create approval requests for pending actions
- `approval_check` tool — Check status of approval requests
- `approval_list` tool — List requests by status with pagination
- `approval_cancel` tool — Cancel pending approval requests
- `approval_policy` tool — View and update approval policy rules
- `approval_stats` tool — Statistics with date filtering and risk breakdown
- Pre-middleware hook that blocks tool execution based on policy rules
- Policy engine with configurable per-tool min_risk thresholds
- Auto-deny on timeout with configurable timeout duration
- UUID-based request ID generation
- In-memory approval queue with status tracking
- Slack and Discord webhook notification support (configurable)
- Configurable risk thresholds: critical_only, high_and_critical, medium_and_above, all
