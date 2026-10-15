import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backgroundReportMessage, nextRun, parseSchedule, planSchedule } from '../src/index.js';
import { model, ScriptedProvider, setup, text, toolCall } from './helpers.js';

const user = (content: string) => ({ role: 'user' as const, content });

test('delegates tasks to parallel subagents with read-only tools', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([
    (req) => {
      // Parent: delegate two tasks.
      if (req.messages[0]!.content.includes('helper agent')) throw new Error('unexpected');
      return toolCall('agent_delegate', { tasks: [{ goal: 'Check course A' }, { goal: 'Check course B', context: 'Fall term' }] });
    },
    (req) => text(`report for ${req.messages.at(-1)!.content.split('\n')[0]}`),
    (req) => text(`report for ${req.messages.at(-1)!.content.split('\n')[0]}`),
    () => text('Both courses are fine'),
  ]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('revisa mis cursos')], sink });
  assert.equal(result.content, 'Both courses are fine');

  const childRequests = provider.requests.filter((r) => r.messages[0]!.content.includes('helper agent'));
  assert.equal(childRequests.length, 2);
  const childTools = childRequests[0]!.tools!.map((t) => t.name);
  assert.ok(childTools.includes('time_now'));
  assert.ok(childTools.includes('agent_delegate'), 'depth 1 may still delegate when maxSubagentDepth is 2');
  for (const banned of ['memory_update', 'cron_create', 'email_send', 'skills_note']) assert.ok(!childTools.includes(banned), banned);
  assert.doesNotMatch(childRequests[0]!.messages[0]!.content, /study-plan/, 'children do not get the skills index');

  const toolResult = provider.requests.at(-1)!.messages.at(-1)!;
  assert.match(toolResult.content, /report for Check course A/);
  assert.match(toolResult.content, /report for Check course B/);
  const tagged = events.filter((e) => e.type === 'subagent');
  assert.ok(tagged.length > 0);
  assert.ok(tagged.every((e) => e.type === 'subagent' && e.parent_call_id === 'call-agent_delegate'));
});

test('the deepest subagents cannot delegate further', async () => {
  const { engine, user: profile, sink } = setup();
  const agent = engine.forUser(profile, { limits: { maxSubagentDepth: 1 } });
  const provider = new ScriptedProvider([() => toolCall('agent_delegate', { tasks: [{ goal: 'g' }] }), () => text('child'), () => text('done')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  const child = provider.requests.find((r) => r.messages[0]!.content.includes('helper agent'))!;
  assert.ok(!child.tools!.some((t) => t.name === 'agent_delegate'));
});

test('too many parallel tasks are refused', async () => {
  const { agent, sink } = setup();
  const tasks = Array.from({ length: 4 }, (_, i) => ({ goal: `t${i}` }));
  const provider = new ScriptedProvider([() => toolCall('agent_delegate', { tasks }), () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /At most 3 tasks/);
});

test('the agent creates, lists and deletes schedules', async () => {
  const { agent, stores, sink } = setup();
  const provider = new ScriptedProvider([
    () => toolCall('cron_create', { name: 'Weekly check', schedule: '0 8 * * 1', prompt: 'Check assignments due this week' }),
    () => text('Listo'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('cada lunes a las 8 revisa mis tareas')], sink });
  const [schedule] = await stores.schedules.list('u1');
  assert.equal(schedule!.name, 'Weekly check');
  assert.equal(schedule!.timezone, 'America/New_York');
  // Clock is 2026-10-13 (Tuesday) 12:00Z: next Monday 8:00 New York (EDT, UTC-4) is 2026-10-19T12:00Z.
  assert.equal(schedule!.nextRunAt, '2026-10-19T12:00:00.000Z');
});

test('scheduled runs cannot manage schedules and get the scheduled-task note', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([() => text('[SILENT]')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('Check assignments')], sink, kind: 'scheduled' });
  const request = provider.requests[0]!;
  assert.ok(!request.tools!.some((t) => t.name.startsWith('cron_')));
  assert.match(request.messages[0]!.content, /\[SILENT\]/);
});

test('schedule limit per user', async () => {
  const { engine, user: profile, sink } = setup();
  const agent = engine.forUser(profile, { limits: { maxSchedules: 1 } });
  const create = (name: string) => toolCall('cron_create', { name, schedule: 'every 1d', prompt: 'p' }, name);
  const provider = new ScriptedProvider([() => [...create('a'), ...create('b')], () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  const results = provider.requests[1]!.messages.filter((m) => m.role === 'tool');
  assert.match(results[0]!.content, /"created": true/);
  assert.match(results[1]!.content, /maximum/);
});

test('cron parsing and next runs', () => {
  const after = new Date('2026-10-13T12:00:00Z');
  assert.equal(nextRun(parseSchedule('*/15 * * * *'), 'UTC', after)!.toISOString(), '2026-10-13T12:15:00.000Z');
  assert.equal(nextRun(parseSchedule('0 9 * * MON-FRI'), 'UTC', after)!.toISOString(), '2026-10-14T09:00:00.000Z');
  assert.equal(nextRun(parseSchedule('30 7 1 JAN *'), 'UTC', after)!.toISOString(), '2027-01-01T07:30:00.000Z');
  // DST: New York leaves EDT on 2026-11-01, so 8:00 local becomes 13:00Z.
  assert.equal(
    nextRun(parseSchedule('0 8 * * *'), 'America/New_York', new Date('2026-11-01T12:30:00Z'))!.toISOString(),
    '2026-11-01T13:00:00.000Z',
  );
  // Both day fields restricted: either matches (classic cron).
  assert.equal(nextRun(parseSchedule('0 0 20 * 1'), 'UTC', after)!.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(nextRun(parseSchedule('every 2h'), 'UTC', after)!.toISOString(), '2026-10-13T14:00:00.000Z');
  assert.equal(
    nextRun(parseSchedule('2026-11-02T09:00'), 'America/New_York', after)!.toISOString(),
    '2026-11-02T14:00:00.000Z',
  );
  assert.equal(nextRun(parseSchedule('2020-01-01T00:00'), 'UTC', after), null);
  assert.throws(() => parseSchedule('every 5m'), /15 minutes/);
  assert.throws(() => parseSchedule('61 * * * *'), /out of range/);
  assert.throws(() => parseSchedule('tomorrow'), /5-field/);
  assert.throws(() => planSchedule('0 8 * * *', 'Mars/Base', after), /Unknown timezone/);
});

test('background delegation hands the tasks to the host and answers right away', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([
    () => toolCall('agent_delegate', { tasks: [{ goal: 'Read all syllabi', context: 'Fall 2026' }], background: true }),
    () => text('Started a helper; I will report back.'),
  ]);
  const started: unknown[] = [];
  const result = await agent.run({
    runId: 'r1',
    model: model(provider),
    history: [{ role: 'user', content: 'read every syllabus' }],
    sink,
    startBackground: async (tasks) => void started.push(...tasks),
  });
  assert.equal(result.content, 'Started a helper; I will report back.');
  assert.deepEqual(started, [{ goal: 'Read all syllabi', context: 'Fall 2026' }]);
  assert.equal(provider.requests.length, 2, 'no helper ran inside the chat run');
  assert.match(String(result.messages.find((m) => m.role === 'tool')?.content), /background/);

  // A host without background support still gets the work done, waiting for it.
  const fallback = new ScriptedProvider([
    () => toolCall('agent_delegate', { tasks: [{ goal: 'g' }], background: true }),
    () => text('child report'),
    () => text('done'),
  ]);
  const waited = await agent.run({ runId: 'r2', model: model(fallback), history: [{ role: 'user', content: 'x' }], sink });
  assert.equal(waited.content, 'done');
  assert.equal(fallback.requests.length, 3);
});

test('runSubagents runs the helpers outside a chat and reports back', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([(req) => text(`report on ${String(req.messages.at(-1)!.content).split('\n')[0]}`)]);
  const { reports, usage } = await agent.runSubagents({
    runId: 'bg1',
    model: model(provider),
    tasks: [{ goal: 'A' }, { goal: 'B', context: 'ctx' }],
    sink,
  });
  assert.deepEqual(
    reports.map((r) => [r.goal, r.status, r.summary]),
    [
      ['A', 'done', 'report on A'],
      ['B', 'done', 'report on B'],
    ],
  );
  assert.ok(usage.inputTokens > 0);
  assert.ok(events.every((e) => e.type === 'subagent' && e.parent_call_id === 'bg1'));
  assert.match(backgroundReportMessage(reports), /not the user[\s\S]*Helper 2 \(done\): B\nreport on B/);
});

test('the main agent picks a model per helper from the host list', async () => {
  const { agent, events, sink } = setup();
  const fast = new ScriptedProvider([() => text('quick report')]);
  const helperModels = {
    list: [
      { ref: 'eagle:fast', label: 'Eagle Fast', tags: ['fast'] },
      { ref: 'eagle:smart', label: 'Eagle Smart', tags: ['smart'] },
    ],
    resolve: async (choice: string) => (choice === 'fast' || choice === 'eagle:fast' ? model(fast, { label: 'Eagle Fast', ref: 'eagle:fast' }) : null),
  };
  const parent = new ScriptedProvider([
    () => toolCall('agent_delegate', { tasks: [{ goal: 'list due dates', model: 'fast' }, { goal: 'plan the week', model: 'missing' }] }),
    () => text('parent child report'),
    () => text('all done'),
  ]);
  const result = await agent.run({ runId: 'r1', model: model(parent), history: [user('plan')], sink, helperModels });
  assert.equal(result.content, 'all done');
  assert.match(parent.requests[0]!.messages[0]!.content, /## Models for helpers[\s\S]*`eagle:fast`: Eagle Fast \[fast\]/);
  assert.equal(fast.requests.length, 1, 'the fast helper ran on the fast model');
  const labels = events.filter((e) => e.type === 'subagent').map((e) => e.type === 'subagent' && `${e.index}:${e.model_label}`);
  assert.ok(labels.includes('0:Eagle Fast') && labels.includes('1:Fake'), 'an unknown choice falls back to the parent model');
  const report = String(result.messages.find((m) => m.role === 'tool')?.content);
  assert.match(report, /"model": "Eagle Fast"/);

  // Without a host list there is no prompt section and helpers use the parent's model.
  const plain = new ScriptedProvider([() => text('hi')]);
  await agent.run({ runId: 'r2', model: model(plain), history: [user('x')], sink });
  assert.doesNotMatch(plain.requests[0]!.messages[0]!.content, /Models for helpers/);
});
