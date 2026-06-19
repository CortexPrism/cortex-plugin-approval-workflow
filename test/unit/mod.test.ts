// deno-lint-ignore-file require-await
import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { preMiddleware, tools } from '../../mod.ts';

function findTool(name: string) {
  return tools.find((t) => t.definition.name === name);
}

Deno.test('tools array — six tools are exported', () => {
  assertEquals(tools.length, 6);
  assertEquals(tools[0].definition.name, 'approval_request');
  assertEquals(tools[1].definition.name, 'approval_check');
  assertEquals(tools[2].definition.name, 'approval_list');
  assertEquals(tools[3].definition.name, 'approval_cancel');
  assertEquals(tools[4].definition.name, 'approval_policy');
  assertEquals(tools[5].definition.name, 'approval_stats');
});

Deno.test('approval_request — creates a pending request', async () => {
  const tool = findTool('approval_request');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({
    action: 'Delete production DB',
    details: 'DROP TABLE users;',
    risk_level: 'critical',
  }, {});

  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertNotEquals(data.id, null);
  assertEquals(data.status, 'pending');
  assertEquals(data.action, 'Delete production DB');
  assertEquals(data.risk_level, 'critical');
});

Deno.test('approval_request — rejects empty action', async () => {
  const tool = findTool('approval_request');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ action: '', details: 'some diff' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'action must be a non-empty string');
});

Deno.test('approval_request — rejects empty details', async () => {
  const tool = findTool('approval_request');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ action: 'test', details: '' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'details must be a non-empty string');
});

Deno.test('approval_request — auto-approves low risk when threshold is high_and_critical', async () => {
  const tool = findTool('approval_request');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({
    action: 'Read a file',
    details: 'cat /etc/hosts',
    risk_level: 'low',
  }, {});

  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(data.status, 'auto_approved');
  assertEquals(data.id, null);
});

Deno.test('approval_check — returns request info by ID', async () => {
  const createTool = findTool('approval_request');
  const checkTool = findTool('approval_check');
  if (!createTool || !checkTool) throw new Error('tool not found');

  const created = await createTool.execute({
    action: 'Test action',
    details: 'test details',
    risk_level: 'high',
  }, {});
  const { id } = JSON.parse(created.output);

  const result = await checkTool.execute({ request_id: id }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(data.id, id);
  assertEquals(data.status, 'pending');
});

Deno.test('approval_check — returns error for missing request ID', async () => {
  const tool = findTool('approval_check');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ request_id: 'nonexistent-id' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'not found');
});

Deno.test('approval_check — rejects empty request_id', async () => {
  const tool = findTool('approval_check');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ request_id: '' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('approval_list — returns all requests by default', async () => {
  const listTool = findTool('approval_list');
  if (!listTool) throw new Error('tool not found');

  const result = await listTool.execute({}, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(typeof data.total, 'number');
  assertEquals(typeof data.returned, 'number');
  assertEquals(Array.isArray(data.requests), true);
});

Deno.test('approval_list — filters by status', async () => {
  const listTool = findTool('approval_list');
  if (!listTool) throw new Error('tool not found');

  const result = await listTool.execute({ status: 'denied' }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  for (const req of data.requests) {
    assertEquals(req.status, 'denied');
  }
});

Deno.test('approval_list — respects limit', async () => {
  const listTool = findTool('approval_list');
  if (!listTool) throw new Error('tool not found');

  const result = await listTool.execute({ limit: 3 }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(data.returned <= 3, true);
});

Deno.test('approval_list — rejects invalid status', async () => {
  const listTool = findTool('approval_list');
  if (!listTool) throw new Error('tool not found');

  const result = await listTool.execute({ status: 'in-progress' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'Invalid status');
});

Deno.test('approval_cancel — cancels a pending request', async () => {
  const createTool = findTool('approval_request');
  const cancelTool = findTool('approval_cancel');
  if (!createTool || !cancelTool) throw new Error('tool not found');

  const created = await createTool.execute({
    action: 'To cancel',
    details: 'details',
    risk_level: 'medium',
  }, {});
  const { id } = JSON.parse(created.output);

  const result = await cancelTool.execute({ request_id: id, reason: 'No longer needed' }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(data.status, 'denied');
  assertEquals(data.reason, 'No longer needed');
});

Deno.test('approval_cancel — rejects missing request', async () => {
  const tool = findTool('approval_cancel');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ request_id: 'nonexistent' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'not found');
});

Deno.test('approval_policy — view returns current policy', async () => {
  const tool = findTool('approval_policy');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ action: 'view' }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(typeof data.requireApprovalFor, 'string');
  assertEquals(Array.isArray(data.rules), true);
});

Deno.test('approval_policy — update with valid rules', async () => {
  const tool = findTool('approval_policy');
  if (!tool) throw new Error('tool not found');

  const newRules = JSON.stringify([
    { tool_name: 'shell:run', min_risk: 'critical', enabled: true },
  ]);

  const result = await tool.execute({ action: 'update', rules: newRules }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(data.message, 'Policy rules updated.');
});

Deno.test('approval_policy — rejects invalid JSON rules', async () => {
  const tool = findTool('approval_policy');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ action: 'update', rules: 'not-json' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'valid JSON');
});

Deno.test('approval_policy — rejects invalid action', async () => {
  const tool = findTool('approval_policy');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ action: 'delete' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'Invalid action');
});

Deno.test('approval_stats — returns statistics', async () => {
  const tool = findTool('approval_stats');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({}, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(typeof data.total, 'number');
  assertEquals(typeof data.pending, 'number');
  assertEquals(typeof data.approved, 'number');
  assertEquals(typeof data.denied, 'number');
  assertEquals(typeof data.by_risk_level, 'object');
});

Deno.test('approval_stats — filters by since date', async () => {
  const tool = findTool('approval_stats');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ since: '2026-06-15T00:00:00Z' }, {});
  assertEquals(result.success, true);
  const data = JSON.parse(result.output);
  assertEquals(data.since, '2026-06-15T00:00:00Z');
});

Deno.test('approval_stats — rejects invalid date', async () => {
  const tool = findTool('approval_stats');
  if (!tool) throw new Error('tool not found');

  const result = await tool.execute({ since: 'not-a-date' }, {});
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'valid ISO date');
});

Deno.test('preMiddleware — blocks a shell:run tool', async () => {
  const result = await preMiddleware('shell:run', { command: 'rm -rf /' }, {});
  if (result) {
    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? '', 'requires human approval');
  }
});

Deno.test('preMiddleware — allows an unknown tool', async () => {
  const result = await preMiddleware('unknown:tool', {}, {});
  assertEquals(result, undefined);
});
