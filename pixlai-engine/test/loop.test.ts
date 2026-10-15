import assert from 'node:assert/strict';
import { test } from 'node:test';
import { model, readPage, ScriptedProvider, setup, slowText, text, toolCall } from './helpers.js';
import { defineTool } from '../src/index.js';

const user = (content: string) => ({ role: 'user' as const, content });

test('answers without tools and reports usage', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([() => text('Hola Ana')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('hola')], sink });
  assert.equal(result.status, 'done');
  assert.equal(result.content, 'Hola Ana');
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, steps: 1 });
  assert.deepEqual(events.map((e) => e.type), ['status', 'model', 'delta', 'usage', 'status']);
  const system = provider.requests[0]!.messages[0]!;
  assert.equal(system.role, 'system');
  assert.match(system.content, /You are TestBot/);
  assert.match(system.content, /Studies at Test University/);
  assert.match(system.content, /study-plan: Study plan/);
});

test('calls a tool, then answers with its result in context', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('time_now'), () => text('Son las 8')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('qué hora es')], sink });
  assert.equal(result.status, 'done');
  assert.equal(result.toolCalls[0]!.status, 'done');
  const toolMessage = provider.requests[1]!.messages.find((m) => m.role === 'tool')!;
  assert.match(toolMessage.content, /America\/New_York/);
  assert.ok(events.some((e) => e.type === 'tool_result'));
  assert.deepEqual(result.messages.map((m) => m.role), ['assistant', 'tool', 'assistant']);
});

test('unknown tools and tool errors come back as results, not crashes', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([
    () => [...toolCall('nope', {}, 'a'), ...toolCall('memory_update', {}, 'b'), ...toolCall('time_now', { timezone: 'Mars/Base' }, 'c')],
    () => text('ok'),
  ]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  assert.equal(result.status, 'done');
  const tools = provider.requests[1]!.messages.filter((m) => m.role === 'tool');
  assert.equal(tools.length, 3, 'every call gets exactly one result');
  assert.match(tools[0]!.content, /does not exist/);
  assert.match(tools[2]!.content, /Unknown timezone/);
});

test('external tools wait for approval; a rejection is reported to the model', async () => {
  const { agent, stores, events, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('email_send', { to: 'prof@uni.edu' }), () => text('No lo envié')]);
  const run = agent.run({ runId: 'r1', model: model(provider), history: [user('manda el correo')], sink });
  await new Promise((r) => setTimeout(r, 20));
  const approval = stores.runs.created[0]!;
  assert.equal(approval.summary, 'Send an email to prof@uni.edu');
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'waiting_approval'));
  stores.runs.decide(approval.id, 'rejected');
  const result = await run;
  assert.equal(result.toolCalls[0]!.status, 'rejected');
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /rejected it/);
});

test('an approved external tool runs', async () => {
  const { agent, stores, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('email_send', { to: 'a@b.edu' }), () => text('Enviado')]);
  const run = agent.run({ runId: 'r1', model: model(provider), history: [user('envía')], sink });
  await new Promise((r) => setTimeout(r, 20));
  stores.runs.decide(stores.runs.created[0]!.id, 'approved');
  const result = await run;
  assert.equal(result.toolCalls[0]!.status, 'done');
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /"sent": true/);
});

test('untrusted results are wrapped and cannot close the wrapper', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('web_read', { url: 'x' }), () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('lee')], sink });
  const content = provider.requests[1]!.messages.at(-1)!.content;
  assert.match(content, /^<untrusted_content source="web_read">/);
  assert.equal(content.match(/<\/untrusted_content>/g)!.length, 1);
  void readPage;
});

test('a steer sent while tools run is applied before the next model call', async () => {
  const { agent, stores, events, sink } = setup();
  let steered = false;
  const provider = new ScriptedProvider([
    () => {
      return toolCall('time_now');
    },
    () => text('Listo, en inglés'),
  ]);
  // Queue the steer as soon as the tool starts.
  const watchingSink = {
    emit: (e: (typeof events)[number]) => {
      events.push(e);
      if (e.type === 'tool_call' && !steered) {
        steered = true;
        stores.runs.steer('r1', 'answer in English');
      }
    },
  };
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('hora')], sink: watchingSink });
  void sink;
  const second = provider.requests[1]!.messages;
  const steer = second.at(-1)!;
  assert.equal(steer.role, 'user');
  assert.match(steer.content, /OUT-OF-BAND USER MESSAGE/);
  assert.match(steer.content, /answer in English/);
  assert.ok(events.some((e) => e.type === 'steer_applied'));
  // Persisted with the user's own words and the steer flag.
  assert.deepEqual(result.messages.find((m) => m.steer), { role: 'user', content: 'answer in English', steer: true });
});

test('a steer mid-answer interrupts the generation and keeps the partial text as context', async () => {
  const { agent, stores, events, sink } = setup();
  const provider = new ScriptedProvider([() => slowText(['Here', 'is', 'a', 'very', 'long', 'answer', 'about', 'all', 'courses']), () => text('Solo este semestre')]);
  const run = agent.run({ runId: 'r1', model: model(provider), history: [user('mis cursos')], sink });
  await new Promise((r) => setTimeout(r, 70));
  stores.runs.steer('r1', 'only this semester');
  const result = await run;
  assert.equal(result.status, 'done');
  assert.equal(result.content, 'Solo este semestre');
  assert.ok(events.some((e) => e.type === 'interrupted'));
  const second = provider.requests[1]!.messages;
  assert.match(second.at(-2)!.content, /interrupted by the user's correction/);
  assert.match(second.at(-1)!.content, /only this semester/);
});

test('running out of steps forces a final answer without tools', async () => {
  const { engine, user: profile, sink } = setup();
  const agent = engine.forUser(profile, { limits: { maxSteps: 2 } });
  const provider = new ScriptedProvider([() => toolCall('time_now'), () => toolCall('time_now'), () => text('Resumen final')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('loop')], sink });
  assert.equal(result.content, 'Resumen final');
  assert.equal(provider.requests.length, 3);
  assert.equal(provider.requests[2]!.tools, undefined);
  assert.match(provider.requests[2]!.messages.at(-1)!.content, /limit of steps/);
});

test('cancelling stops the run', async () => {
  const { agent, sink } = setup();
  const controller = new AbortController();
  const provider = new ScriptedProvider([() => slowText(['a', 'b', 'c', 'd', 'e', 'f'], 30)]);
  const run = agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  const result = await run;
  assert.equal(result.status, 'cancelled');
});

test('models without tool calling get no tools and a notice', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([() => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider, { supportsTools: false }), history: [user('x')], sink });
  assert.equal(provider.requests[0]!.tools, undefined);
  assert.ok(events.some((e) => e.type === 'notice'));
  assert.match(provider.requests[0]!.messages[0]!.content, /cannot use tools/);
});

test('long histories are compacted before they overflow the window', async () => {
  const { agent, sink } = setup();
  const history = Array.from({ length: 40 }, (_, i) => ({
    role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
    content: `message ${i} ${'x'.repeat(400)}`,
  }));
  history.push({ role: 'user', content: 'latest question' });
  const provider = new ScriptedProvider([() => text('summary of the past'), () => text('answer')]);
  const result = await agent.run({ runId: 'r1', model: model(provider, { contextWindow: 2000 }), history, sink });
  assert.equal(result.content, 'answer');
  const sent = provider.requests[1]!.messages;
  assert.ok(sent.length < history.length);
  assert.match(sent[1]!.content, /SUMMARIZED/);
  assert.equal(sent.at(-1)!.content, 'latest question');
});

test('each user has their own memory', async () => {
  const { engine, sink } = setup();
  const ana = engine.forUser({ id: 'ana', name: 'Ana', language: 'es', timezone: 'UTC' });
  const leo = engine.forUser({ id: 'leo', name: 'Leo', language: 'en', timezone: 'UTC' });
  const saving = new ScriptedProvider([() => toolCall('memory_update', { target: 'user', action: 'add', content: 'Ana prefers mornings' }), () => text('ok')]);
  await ana.run({ runId: 'a', model: model(saving), history: [user('remember')], sink });
  const anaNext = new ScriptedProvider([() => text('ok')]);
  await ana.run({ runId: 'a2', model: model(anaNext), history: [user('hi')], sink });
  const leoNext = new ScriptedProvider([() => text('ok')]);
  await leo.run({ runId: 'b', model: model(leoNext), history: [user('hi')], sink });
  assert.match(anaNext.requests[0]!.messages[0]!.content, /Ana prefers mornings/);
  assert.doesNotMatch(leoNext.requests[0]!.messages[0]!.content, /Ana prefers mornings/);
});

test('an empty model reply is retried once with a nudge, then accepted', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([() => [{ type: 'usage', inputTokens: 5, outputTokens: 900 }], () => text('Here is your answer')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('make the excel')], sink });
  assert.equal(result.content, 'Here is your answer');
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /arrived empty/);
  // The nudge is not kept in the conversation.
  assert.ok(!result.messages.some((m) => /arrived empty/.test(m.content)));

  const always = new ScriptedProvider([() => []]);
  const blank = await agent.run({ runId: 'r2', model: model(always), history: [user('x')], sink });
  assert.equal(always.requests.length, 2, 'only one retry');
  assert.equal(blank.status, 'done');
});

test('approval text can be async and read host data', async () => {
  const { engine, user: profile, stores, sink } = setup({
    tools: [
      defineTool<{ id: string }>({
        name: 'mail_send',
        description: 'Send a saved draft',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
        sideEffect: 'external',
        describe: async (args, ctx) => {
          const drafts = ctx.host.drafts as Record<string, string>;
          return { summary: `Send "${drafts[args.id]}"`, details: { subject: drafts[args.id]! } };
        },
        async run() {
          return 'sent';
        },
      }),
    ],
  });
  const agent = engine.forUser(profile, { host: { drafts: { d1: 'Exam question' } } });
  const p = new ScriptedProvider([() => toolCall('mail_send', { id: 'd1' }), () => text('ok')]);
  const run = agent.run({ runId: 'r1', model: model(p), history: [user('send')], sink });
  while (stores.runs.created.length === 0) await new Promise((r) => setTimeout(r, 10));
  assert.equal(stores.runs.created[0]!.summary, 'Send "Exam question"');
  stores.runs.decide(stores.runs.created[0]!.id, 'approved');
  await run;
});

test('a dropped connection is retried; a real error is not', async () => {
  const { agent, events, sink } = setup();
  const dropped = new ScriptedProvider([
    async function* () {
      yield { type: 'text', text: 'Half an ans' };
      throw new TypeError('terminated');
    },
    () => text('The whole answer'),
  ]);
  const result = await agent.run({ runId: 'r1', model: model(dropped), history: [user('hi')], sink });
  assert.equal(result.content, 'The whole answer');
  assert.equal(dropped.requests.length, 2);
  assert.ok(events.some((e) => e.type === 'interrupted'), 'the half answer is cleared');

  const refused = new ScriptedProvider([
    () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    },
  ]);
  const failed = await agent.run({ runId: 'r2', model: model(refused), history: [user('hi')], sink });
  assert.equal(failed.status, 'failed');
  assert.equal(refused.requests.length, 1);
});
