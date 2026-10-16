import assert from 'node:assert/strict';
import { test } from 'node:test';
import { model, ScriptedProvider, sendEmail, setup, text, toolCall } from './helpers.js';
import { defineTool, type ModelRequest } from '../src/index.js';

const user = (content: string) => ({ role: 'user' as const, content });
const offered = (request: ModelRequest) => (request.tools ?? []).map((t) => t.name);

const crmLookup = defineTool<{ name: string }>({
  name: 'crm_lookup',
  description: 'Find a customer',
  parameters: { type: 'object', properties: { name: { type: 'string' } } },
  sideEffect: 'none',
  group: 'crm',
  async run(args) {
    return { found: args.name };
  },
});

const lazy = () => setup({ tools: [sendEmail, crmLookup], lazyToolGroups: true, toolGroupNotes: { crm: 'Look up customers.' } });

test('without lazy groups every tool is offered and nothing is listed', async () => {
  const { agent, sink } = setup({ tools: [sendEmail, crmLookup] });
  const provider = new ScriptedProvider([() => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('hola')], sink });
  const names = offered(provider.requests[0]!);
  assert.ok(names.includes('crm_lookup') && names.includes('cron_create'));
  assert.ok(!names.includes('tools_load'));
  assert.doesNotMatch(provider.requests[0]!.messages[0]!.content, /## More tools/);
});

test('grouped tools wait for tools_load; the prompt lists the groups', async () => {
  const { agent, sink } = lazy();
  const provider = new ScriptedProvider([() => toolCall('tools_load', { groups: ['crm', 'nope'] }), () => text('ok')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('busca a Ana')], sink });
  assert.equal(result.status, 'done');

  const first = offered(provider.requests[0]!);
  assert.ok(first.includes('tools_load') && first.includes('time_now') && first.includes('email_send'), 'ungrouped tools are always there');
  assert.ok(!first.includes('crm_lookup') && !first.includes('cron_create'), 'grouped tools are not offered yet');
  const system = provider.requests[0]!.messages[0]!.content;
  assert.match(system, /## More tools/);
  assert.match(system, /- crm: Look up customers\. \(crm_lookup\)/);
  assert.match(system, /- schedules: .*\(cron_create, cron_list, cron_update, cron_delete\)/, 'engine packs come grouped');

  const second = offered(provider.requests[1]!);
  assert.ok(second.includes('crm_lookup'), 'the loaded group is offered from the next call');
  assert.ok(!second.includes('cron_create'), 'groups not asked for stay out');
  const loadResult = provider.requests[1]!.messages.find((m) => m.role === 'tool')!.content;
  assert.match(loadResult, /"crm"/);
  assert.match(loadResult, /"unknown"/);
  assert.equal(provider.requests[1]!.messages[0]!.content, system, 'the system prompt stays byte-stable');
});

test('a group already used in the conversation is offered from the start', async () => {
  const { agent, sink } = lazy();
  const provider = new ScriptedProvider([() => text('ok')]);
  const history = [
    user('busca a Ana'),
    { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'crm_lookup', args: { name: 'Ana' } }] },
    { role: 'tool' as const, toolCallId: 'c1', name: 'crm_lookup', content: '{"found":"Ana"}' },
    { role: 'assistant' as const, content: 'Encontré a Ana' },
    user('¿y a Leo?'),
  ];
  await agent.run({ runId: 'r1', model: model(provider), history, sink });
  assert.ok(offered(provider.requests[0]!).includes('crm_lookup'));
});

test('the host can start a run with groups loaded', async () => {
  const { agent, sink } = lazy();
  const provider = new ScriptedProvider([() => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('hola')], sink, toolGroups: ['crm', 'missing'] });
  assert.ok(offered(provider.requests[0]!).includes('crm_lookup'));
});

test('calling a grouped tool by name runs it and loads its group', async () => {
  const { agent, sink } = lazy();
  const provider = new ScriptedProvider([() => toolCall('crm_lookup', { name: 'Ana' }), () => text('ok')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('busca a Ana')], sink });
  assert.equal(result.toolCalls[0]!.status, 'done');
  assert.ok(offered(provider.requests[1]!).includes('crm_lookup'));
});

test('helpers start with the groups their parent loaded', async () => {
  const { agent, sink } = lazy();
  const provider = new ScriptedProvider([
    () => toolCall('tools_load', { groups: ['crm'] }),
    () => toolCall('agent_delegate', { tasks: [{ goal: 'Busca a Ana' }] }),
    () => text('Ana existe'),
    () => text('Listo'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('busca a Ana')], sink });
  const helperRequest = provider.requests[2]!;
  assert.match(helperRequest.messages[1]!.content, /Busca a Ana/);
  assert.ok(offered(helperRequest).includes('crm_lookup'));
});

test('with nothing grouped, tools_load is not offered', async () => {
  const { agent, sink } = setup({ lazyToolGroups: true, disableBuiltins: ['cron_create', 'cron_list', 'cron_update', 'cron_delete'] });
  const provider = new ScriptedProvider([() => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('hola')], sink });
  assert.ok(!offered(provider.requests[0]!).includes('tools_load'));
  assert.doesNotMatch(provider.requests[0]!.messages[0]!.content, /## More tools/);
});
