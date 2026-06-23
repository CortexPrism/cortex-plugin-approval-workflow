// deno-lint-ignore-file
import type { PluginContext, Tool, ToolCallResult } from "cortex/plugins";

interface ApprovalRequest {
  id: string;
  action: string;
  details: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "denied";
  created_at: string;
  updated_at: string;
  timeout_minutes: number;
  auto_deny_on_timeout: boolean;
  reviewed_by?: string;
  reviewer_comment?: string;
}

const VALID_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const VALID_STATUSES = ["pending", "approved", "denied"] as const;
const VALID_POLICY_ACTIONS = ["view", "update"] as const;

let approvalQueue: Map<string, ApprovalRequest> = new Map();
let timeoutHandles: Map<string, number> = new Map();

interface PluginConfig {
  defaultTimeoutMinutes: number;
  autoDenyOnTimeout: boolean;
  requireApprovalFor:
    | "critical_only"
    | "high_and_critical"
    | "medium_and_above"
    | "all";
  notifySlack?: string;
  notifyDiscord?: string;
  policyRules: ApprovalPolicyRule[];
}

interface ApprovalPolicyRule {
  tool_name: string;
  min_risk: "low" | "medium" | "high" | "critical";
  enabled: boolean;
}

const DEFAULT_POLICY_RULES: ApprovalPolicyRule[] = [
  { tool_name: "shell:run", min_risk: "medium", enabled: true },
  { tool_name: "shell:exec", min_risk: "medium", enabled: true },
  { tool_name: "fs:write", min_risk: "high", enabled: true },
  { tool_name: "fs:delete", min_risk: "critical", enabled: true },
  { tool_name: "git:push", min_risk: "high", enabled: true },
  { tool_name: "git:merge", min_risk: "critical", enabled: true },
  { tool_name: "pr:merge", min_risk: "critical", enabled: true },
  { tool_name: "network:fetch", min_risk: "medium", enabled: true },
];

const RISK_LEVEL_WEIGHT: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

let pluginConfig: PluginConfig = {
  defaultTimeoutMinutes: 30,
  autoDenyOnTimeout: true,
  requireApprovalFor: "high_and_critical",
  policyRules: [...DEFAULT_POLICY_RULES],
};

function generateRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20, 32)}`;
}

function riskExceedsThreshold(riskLevel: string, threshold: string): boolean {
  const riskWeight = RISK_LEVEL_WEIGHT[riskLevel] ?? 0;
  let minWeight: number;

  switch (threshold) {
    case "critical_only":
      minWeight = RISK_LEVEL_WEIGHT["critical"];
      break;
    case "high_and_critical":
      minWeight = RISK_LEVEL_WEIGHT["high"];
      break;
    case "medium_and_above":
      minWeight = RISK_LEVEL_WEIGHT["medium"];
      break;
    case "all":
      minWeight = RISK_LEVEL_WEIGHT["low"];
      break;
    default:
      minWeight = RISK_LEVEL_WEIGHT["high"];
  }

  return riskWeight >= minWeight;
}

function startAutoDenyTimer(requestId: string, timeoutMinutes: number): void {
  const existing = timeoutHandles.get(requestId);
  if (existing) clearTimeout(existing);

  const ms = timeoutMinutes * 60 * 1000;
  const handle = setTimeout(() => {
    const req = approvalQueue.get(requestId);
    if (req && req.status === "pending" && req.auto_deny_on_timeout) {
      req.status = "denied";
      req.updated_at = new Date().toISOString();
      req.reviewer_comment = "Auto-denied: timeout expired";
      approvalQueue.set(requestId, req);
    }
    timeoutHandles.delete(requestId);
  }, ms);

  timeoutHandles.set(requestId, handle);
}

function makeResult(
  toolName: string,
  success: boolean,
  output: string,
  startTime: number,
  error?: string,
): ToolCallResult {
  return {
    toolName,
    success,
    output,
    error,
    durationMs: Date.now() - startTime,
  };
}

function getApprovalThreshold(riskLevel: string): string {
  return pluginConfig.requireApprovalFor ?? "high_and_critical";
}

const approvalRequestTool: Tool = {
  definition: {
    name: "approval_request",
    description: "Create an approval request for a pending action",
    params: [
      {
        name: "action",
        type: "string",
        description: "Description of what needs approval",
        required: true,
      },
      {
        name: "details",
        type: "string",
        description: "Diff, command, or change details",
        required: true,
      },
      {
        name: "risk_level",
        type: "string",
        description: "Risk level: low, medium, high, or critical",
        required: false,
      },
      {
        name: "timeout_minutes",
        type: "number",
        description: "Minutes before timeout",
        required: false,
      },
      {
        name: "auto_deny_on_timeout",
        type: "boolean",
        description: "Auto-deny on timeout",
        required: false,
      },
    ],
    capabilities: ["tools"],
  },

  execute: async (
    args: Record<string, unknown>,
    _ctx: PluginContext,
  ): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const action = args.action;
      if (!action || typeof action !== "string") {
        return makeResult(
          "approval_request",
          false,
          "",
          start,
          "action must be a non-empty string",
        );
      }

      const details = args.details;
      if (!details || typeof details !== "string") {
        return makeResult(
          "approval_request",
          false,
          "",
          start,
          "details must be a non-empty string",
        );
      }

      let riskLevel = (args.risk_level as string) ?? "medium";
      if (
        !VALID_RISK_LEVELS.includes(
          riskLevel as typeof VALID_RISK_LEVELS[number],
        )
      ) {
        riskLevel = "medium";
      }

      const threshold = getApprovalThreshold(riskLevel);
      if (!riskExceedsThreshold(riskLevel, threshold)) {
        return makeResult(
          "approval_request",
          true,
          JSON.stringify({
            id: null,
            status: "auto_approved",
            message:
              `Risk level '${riskLevel}' is below threshold '${threshold}'. No approval required.`,
          }),
          start,
        );
      }

      const timeoutMinutes = typeof args.timeout_minutes === "number"
        ? args.timeout_minutes
        : pluginConfig.defaultTimeoutMinutes;

      const autoDeny = typeof args.auto_deny_on_timeout === "boolean"
        ? args.auto_deny_on_timeout
        : pluginConfig.autoDenyOnTimeout;

      const id = generateRequestId();
      const now = new Date().toISOString();

      const request: ApprovalRequest = {
        id,
        action: action as string,
        details: details as string,
        risk_level: riskLevel as ApprovalRequest["risk_level"],
        status: "pending",
        created_at: now,
        updated_at: now,
        timeout_minutes: timeoutMinutes,
        auto_deny_on_timeout: autoDeny,
      };

      approvalQueue.set(id, request);
      startAutoDenyTimer(id, timeoutMinutes);

      return makeResult(
        "approval_request",
        true,
        JSON.stringify({
          id,
          status: "pending",
          action: request.action,
          risk_level: request.risk_level,
          timeout_minutes: request.timeout_minutes,
          auto_deny_on_timeout: request.auto_deny_on_timeout,
          created_at: request.created_at,
          message: "Approval request created. Awaiting human review.",
        }),
        start,
      );
    } catch (error) {
      return makeResult(
        "approval_request",
        false,
        "",
        start,
        `Failed to create approval request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

const approvalCheckTool: Tool = {
  definition: {
    name: "approval_check",
    description: "Check the status of an approval request",
    params: [
      {
        name: "request_id",
        type: "string",
        description: "The ID of the approval request",
        required: true,
      },
    ],
    capabilities: ["tools"],
  },

  execute: async (
    args: Record<string, unknown>,
    _ctx: PluginContext,
  ): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const requestId = args.request_id;
      if (!requestId || typeof requestId !== "string") {
        return makeResult(
          "approval_check",
          false,
          "",
          start,
          "request_id must be a non-empty string",
        );
      }

      const request = approvalQueue.get(requestId as string);
      if (!request) {
        return makeResult(
          "approval_check",
          false,
          "",
          start,
          `Approval request '${requestId}' not found`,
        );
      }

      return makeResult(
        "approval_check",
        true,
        JSON.stringify({
          id: request.id,
          status: request.status,
          action: request.action,
          risk_level: request.risk_level,
          created_at: request.created_at,
          updated_at: request.updated_at,
          reviewer_comment: request.reviewer_comment ?? null,
          reviewed_by: request.reviewed_by ?? null,
        }),
        start,
      );
    } catch (error) {
      return makeResult(
        "approval_check",
        false,
        "",
        start,
        `Failed to check approval: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

const approvalListTool: Tool = {
  definition: {
    name: "approval_list",
    description: "List approval requests filtered by status",
    params: [
      {
        name: "status",
        type: "string",
        description: "Filter by status: pending, approved, denied, or all",
        required: false,
      },
      {
        name: "limit",
        type: "number",
        description: "Max results (default 20)",
        required: false,
      },
    ],
    capabilities: ["tools"],
  },

  execute: async (
    args: Record<string, unknown>,
    _ctx: PluginContext,
  ): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const statusFilter = (args.status as string) ?? "all";
      if (
        statusFilter !== "all" &&
        !VALID_STATUSES.includes(statusFilter as typeof VALID_STATUSES[number])
      ) {
        return makeResult(
          "approval_list",
          false,
          "",
          start,
          `Invalid status '${statusFilter}'. Must be one of: all, pending, approved, denied`,
        );
      }

      const limit = typeof args.limit === "number"
        ? Math.max(1, Math.floor(args.limit))
        : 20;

      let requests = Array.from(approvalQueue.values());

      if (statusFilter !== "all") {
        requests = requests.filter((r) => r.status === statusFilter);
      }

      requests.sort((a, b) => b.created_at.localeCompare(a.created_at));

      const sliced = requests.slice(0, limit);

      return makeResult(
        "approval_list",
        true,
        JSON.stringify({
          total: requests.length,
          returned: sliced.length,
          requests: sliced.map((r) => ({
            id: r.id,
            action: r.action,
            risk_level: r.risk_level,
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
          })),
        }),
        start,
      );
    } catch (error) {
      return makeResult(
        "approval_list",
        false,
        "",
        start,
        `Failed to list approvals: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

const approvalCancelTool: Tool = {
  definition: {
    name: "approval_cancel",
    description: "Cancel a pending approval request",
    params: [
      {
        name: "request_id",
        type: "string",
        description: "The ID of the approval request",
        required: true,
      },
      {
        name: "reason",
        type: "string",
        description: "Reason for cancellation",
        required: false,
      },
    ],
    capabilities: ["tools"],
  },

  execute: async (
    args: Record<string, unknown>,
    _ctx: PluginContext,
  ): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const requestId = args.request_id;
      if (!requestId || typeof requestId !== "string") {
        return makeResult(
          "approval_cancel",
          false,
          "",
          start,
          "request_id must be a non-empty string",
        );
      }

      const request = approvalQueue.get(requestId as string);
      if (!request) {
        return makeResult(
          "approval_cancel",
          false,
          "",
          start,
          `Approval request '${requestId}' not found`,
        );
      }

      if (request.status !== "pending") {
        return makeResult(
          "approval_cancel",
          false,
          "",
          start,
          `Cannot cancel request '${requestId}': status is '${request.status}'`,
        );
      }

      const handle = timeoutHandles.get(requestId as string);
      if (handle) {
        clearTimeout(handle);
        timeoutHandles.delete(requestId as string);
      }

      request.status = "denied";
      request.updated_at = new Date().toISOString();
      request.reviewer_comment = (args.reason as string) ??
        "Cancelled by agent";
      approvalQueue.set(requestId as string, request);

      return makeResult(
        "approval_cancel",
        true,
        JSON.stringify({
          id: request.id,
          status: "denied",
          reason: request.reviewer_comment,
          message: "Approval request cancelled.",
        }),
        start,
      );
    } catch (error) {
      return makeResult(
        "approval_cancel",
        false,
        "",
        start,
        `Failed to cancel approval: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

const approvalPolicyTool: Tool = {
  definition: {
    name: "approval_policy",
    description: "View or update the approval policy rules",
    params: [
      {
        name: "action",
        type: "string",
        description: "View or update policy rules (default 'view')",
        required: false,
      },
      {
        name: "rules",
        type: "string",
        description:
          "JSON array of rule objects (required when action is 'update')",
        required: false,
      },
    ],
    capabilities: ["tools"],
  },

  execute: async (
    args: Record<string, unknown>,
    _ctx: PluginContext,
  ): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const policyAction = (args.action as string) ?? "view";
      if (
        !VALID_POLICY_ACTIONS.includes(
          policyAction as typeof VALID_POLICY_ACTIONS[number],
        )
      ) {
        return makeResult(
          "approval_policy",
          false,
          "",
          start,
          `Invalid action '${policyAction}'. Must be 'view' or 'update'`,
        );
      }

      if (policyAction === "view") {
        return makeResult(
          "approval_policy",
          true,
          JSON.stringify({
            requireApprovalFor: pluginConfig.requireApprovalFor,
            defaultTimeoutMinutes: pluginConfig.defaultTimeoutMinutes,
            autoDenyOnTimeout: pluginConfig.autoDenyOnTimeout,
            rules: pluginConfig.policyRules,
          }),
          start,
        );
      }

      const rulesArg = args.rules;
      if (!rulesArg || typeof rulesArg !== "string") {
        return makeResult(
          "approval_policy",
          false,
          "",
          start,
          "rules must be a JSON string when action is update",
        );
      }

      let parsedRules: ApprovalPolicyRule[];
      try {
        parsedRules = JSON.parse(rulesArg);
      } catch {
        return makeResult(
          "approval_policy",
          false,
          "",
          start,
          "rules must be a valid JSON array",
        );
      }

      if (!Array.isArray(parsedRules)) {
        return makeResult(
          "approval_policy",
          false,
          "",
          start,
          "rules must be a JSON array",
        );
      }

      for (const rule of parsedRules) {
        if (!rule.tool_name || typeof rule.tool_name !== "string") {
          return makeResult(
            "approval_policy",
            false,
            "",
            start,
            "Each rule must have a tool_name string",
          );
        }
        if (!rule.min_risk || !VALID_RISK_LEVELS.includes(rule.min_risk)) {
          return makeResult(
            "approval_policy",
            false,
            "",
            start,
            "Each rule must have a valid min_risk: low, medium, high, or critical",
          );
        }
        rule.enabled = rule.enabled !== false;
      }

      pluginConfig.policyRules = parsedRules;

      return makeResult(
        "approval_policy",
        true,
        JSON.stringify({
          message: "Policy rules updated.",
          rules: pluginConfig.policyRules,
        }),
        start,
      );
    } catch (error) {
      return makeResult(
        "approval_policy",
        false,
        "",
        start,
        `Failed to manage policy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

const approvalStatsTool: Tool = {
  definition: {
    name: "approval_stats",
    description: "Get statistics about approval requests",
    params: [
      {
        name: "since",
        type: "string",
        description: "ISO date filter",
        required: false,
      },
    ],
    capabilities: ["tools"],
  },

  execute: async (
    args: Record<string, unknown>,
    _ctx: PluginContext,
  ): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const sinceArg = args.since;
      let sinceDate: Date | null = null;

      if (sinceArg && typeof sinceArg === "string") {
        sinceDate = new Date(sinceArg);
        if (isNaN(sinceDate.getTime())) {
          return makeResult(
            "approval_stats",
            false,
            "",
            start,
            "since must be a valid ISO date string",
          );
        }
      }

      let requests = Array.from(approvalQueue.values());

      if (sinceDate) {
        requests = requests.filter((r) => new Date(r.created_at) >= sinceDate!);
      }

      const total = requests.length;
      const pending = requests.filter((r) => r.status === "pending").length;
      const approved = requests.filter((r) => r.status === "approved").length;
      const denied = requests.filter((r) => r.status === "denied").length;

      const riskCounts: Record<string, number> = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      };
      for (const r of requests) {
        riskCounts[r.risk_level] = (riskCounts[r.risk_level] ?? 0) + 1;
      }

      let avgResponseTimeSec: number | null = null;
      const responded = requests.filter((r) => r.status !== "pending");
      if (responded.length > 0) {
        const totalMs = responded.reduce((sum, r) => {
          return sum +
            (new Date(r.updated_at).getTime() -
              new Date(r.created_at).getTime());
        }, 0);
        avgResponseTimeSec = Math.round((totalMs / responded.length) / 1000);
      }

      return makeResult(
        "approval_stats",
        true,
        JSON.stringify({
          total,
          pending,
          approved,
          denied,
          approval_rate: total > 0
            ? Math.round((approved / total) * 100) / 100
            : 0,
          avg_response_time_seconds: avgResponseTimeSec,
          by_risk_level: riskCounts,
          since: sinceArg ?? null,
        }),
        start,
      );
    } catch (error) {
      return makeResult(
        "approval_stats",
        false,
        "",
        start,
        `Failed to compute stats: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

export async function onLoad(ctx: PluginContext): Promise<void> {
  ctx.logger.info(`[cortex-plugin-approval-workflow] Loaded`);
  try {
    const loadedConfig = await ctx.config.get<Partial<PluginConfig>>();
    if (loadedConfig) {
      pluginConfig = {
        defaultTimeoutMinutes: loadedConfig.defaultTimeoutMinutes ??
          pluginConfig.defaultTimeoutMinutes,
        autoDenyOnTimeout: loadedConfig.autoDenyOnTimeout ??
          pluginConfig.autoDenyOnTimeout,
        requireApprovalFor: loadedConfig.requireApprovalFor ??
          pluginConfig.requireApprovalFor,
        notifySlack: loadedConfig.notifySlack,
        notifyDiscord: loadedConfig.notifyDiscord,
        policyRules: loadedConfig.policyRules ?? pluginConfig.policyRules,
      };
    }
  } catch {
    // Use defaults if config is unavailable
  }
}

export async function onUnload(_ctx: PluginContext): Promise<void> {
  for (const handle of timeoutHandles.values()) {
    clearTimeout(handle);
  }
  timeoutHandles.clear();
}

export const tools: Tool[] = [
  approvalRequestTool,
  approvalCheckTool,
  approvalListTool,
  approvalCancelTool,
  approvalPolicyTool,
  approvalStatsTool,
];
