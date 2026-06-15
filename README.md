# Cortex Plugin — Approval Workflow

Human-in-the-Loop Approval plugin for CortexPrism. Pauses agent execution at critical decision points
(file writes, shell commands, PR merges) and routes to a human reviewer via Slack, Discord, or Web UI
with diff previews and one-click approve/deny.

## Installation

```bash
cortex plugin install marketplace:cortex-plugin-approval-workflow

cortex plugin install github:CortexPrism/cortex-plugin-approval-workflow

cortex plugin install ./manifest.json
```

## Quick Start

After installation, the plugin registers six tools and a pre-middleware hook:

```bash
cortex tools list
```

Use in an agent session:

```bash
cortex chat --plugin cortex-plugin-approval-workflow
```

## Configuration

Configure via the plugin UI or in `~/.cortex/config.json`:

```json
{
  "plugins": {
    "cortex-plugin-approval-workflow": {
      "enabled": true,
      "config": {
        "defaultTimeoutMinutes": 30,
        "autoDenyOnTimeout": true,
        "requireApprovalFor": "high_and_critical"
      }
    }
  }
}
```

### Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `defaultTimeoutMinutes` | number | 30 | Minutes before a pending request times out |
| `autoDenyOnTimeout` | boolean | true | Auto-deny when timeout expires |
| `requireApprovalFor` | select | `high_and_critical` | Minimum risk level requiring approval |
| `notifySlack` | text | — | Slack webhook URL for notifications |
| `notifyDiscord` | text | — | Discord webhook URL for notifications |

### Risk Thresholds

| Value | Behavior |
|---|---|
| `critical_only` | Only critical-risk actions require approval |
| `high_and_critical` | High and critical-risk actions require approval |
| `medium_and_above` | Medium, high, and critical-risk actions require approval |
| `all` | All actions regardless of risk require approval |

## Tools

### approval_request

Create an approval request for a pending action. Pauses agent execution and routes to human reviewers.

**Parameters:**
- `action` (string, required) — Description of what needs approval
- `details` (string, required) — Diff, command, or change details to review
- `risk_level` (string) — `low`, `medium`, `high`, or `critical` (default `medium`)
- `timeout_minutes` (number) — Override default timeout (default 30)
- `auto_deny_on_timeout` (boolean) — Override auto-deny behavior (default true)

**Example:**
```bash
cortex tool call approval_request \
  --action "Delete production database records" \
  --details "$(cat delete_migration.sql)" \
  --risk_level critical \
  --timeout_minutes 15
```

### approval_check

Check the status of an approval request by its ID.

**Parameters:**
- `request_id` (string, required) — The approval request ID

**Example:**
```bash
cortex tool call approval_check \
  --request_id "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### approval_list

List approval requests filtered by status.

**Parameters:**
- `status` (string) — `pending`, `approved`, `denied`, or `all` (default `all`)
- `limit` (number) — Maximum results (default 20)

**Example:**
```bash
cortex tool call approval_list --status pending --limit 10
```

### approval_cancel

Cancel a pending approval request.

**Parameters:**
- `request_id` (string, required) — The approval request ID
- `reason` (string) — Reason for cancellation

**Example:**
```bash
cortex tool call approval_cancel \
  --request_id "a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  --reason "No longer needed"
```

### approval_policy

View or update the approval policy rules.

**Parameters:**
- `action` (string) — `view` or `update` (default `view`)
- `rules` (string) — JSON array of rule objects (required for `update`)

**Example — View:**
```bash
cortex tool call approval_policy --action view
```

**Example — Update:**
```bash
cortex tool call approval_policy \
  --action update \
  --rules '[{"tool_name":"shell:run","min_risk":"high","enabled":true}]'
```

### approval_stats

Get statistics about approval requests.

**Parameters:**
- `since` (string) — ISO date filter (e.g. `2026-06-01T00:00:00Z`)

**Example:**
```bash
cortex tool call approval_stats --since "2026-06-01T00:00:00Z"
```

## Pre-Middleware

The plugin registers a `preMiddleware` hook that fires before every tool execution. It checks the
active policy rules and blocks tools that require human approval.

**Integration example:**

```typescript
// In a Cortex agent config:
{
  "plugins": {
    "cortex-plugin-approval-workflow": {
      "policyRules": [
        { "tool_name": "shell:run", "min_risk": "medium", "enabled": true },
        { "tool_name": "fs:write", "min_risk": "high", "enabled": true },
        { "tool_name": "git:merge", "min_risk": "critical", "enabled": true }
      ]
    }
  }
}
```

When a tool requiring approval is invoked, the middleware blocks execution and instructs the agent to
call `approval_request` first. The agent pauses until the request is approved or denied.

## Capabilities

| Capability | Description |
|---|---|
| `tools` | Registers six approval workflow tools |
| `middleware:pre` | Pre-middleware hook intercepts tool execution |
| `events:listener` | Listens for approval events (approve/deny/cancel) |

## Policy Rules

Default policy rules (editable via `approval_policy` tool):

| Tool | Min Risk |
|---|---|
| `shell:run` | medium |
| `shell:exec` | medium |
| `fs:write` | high |
| `fs:delete` | critical |
| `git:push` | high |
| `git:merge` | critical |
| `pr:merge` | critical |
| `network:fetch` | medium |

## Auto-Deny Timeout

Each approval request has a configurable timeout. When the timeout expires and `auto_deny_on_timeout` is
enabled, the request is automatically denied. The default timeout is 30 minutes.

## Notifications

Configure Slack or Discord webhook URLs in the plugin settings to receive real-time notifications
when approval requests are created.

## Development

### Setup

```bash
deno cache mod.ts
deno task test
```

### Validate

```bash
deno task validate
```

### Local Testing

```bash
cortex plugin install ./manifest.json
cortex tool call approval_list --status all
cortex chat --plugin cortex-plugin-approval-workflow
```

## Best Practices

- Set `requireApprovalFor` to match your team's risk tolerance
- Configure webhooks for instant reviewer notifications
- Use descriptive `action` and `details` fields so reviewers have full context
- Review policy rules regularly and tune min_risk thresholds
- Keep default timeout short enough to not block CI but long enough for manual review

## License

MIT — See [LICENSE](./LICENSE)

## Support

- [Developing Plugins](https://cortexprism.io/docs/developer-guide)
- [Discord Community](https://discord.gg/y7DkaEbPQC)
- [Report Issues](https://github.com/CortexPrism/cortex/issues)
