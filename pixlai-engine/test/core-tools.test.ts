import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineTool, evaluate } from '../src/index.js';
import { model, ScriptedProvider, setup, text, toolCall } from './helpers.js';

const user = (content: string) => ({ role: 'user' as const, content });

test('calc evaluates arithmetic exactly and safely', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512, 'power is right associative');
  assert.equal(evaluate('2 ** 10'), 1024);
  assert.equal(evaluate('-3 + 5'), 2);
  assert.equal(evaluate('avg(88, 92, 79) * 0.4 + 95 * 0.6'), 0.4 * ((88 + 92 + 79) / 3) + 57);
  assert.equal(evaluate('round(10 / 3, 2)'), 3.33);
  assert.equal(evaluate('sqrt(16) + abs(-2) + max(1, 7, 3)'), 13);
  assert.equal(evaluate('log(1000)'), 3);
  assert.equal(evaluate('log(8, 2)'), 3);
  assert.ok(Math.abs(evaluate('sin(pi / 2)') - 1) < 1e-12);
  assert.equal(evaluate('1.5e2'), 150);
  assert.throws(() => evaluate('1 / 0'), /Division by zero/);
  assert.throws(() => evaluate('process.exit()'), /Unknown name|Unexpected/);
  assert.throws(() => evaluate('constructor'), /Unknown name/);
  assert.throws(() => evaluate('2 +'), /end of expression/);
  assert.throws(() => evaluate('(2 + 3'), /Missing/);
  assert.throws(() => evaluate('2 $ 3'), /Unexpected/);
});

test('calc tool returns the result to the model', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('calc', { expression: '(90 + 80) / 2' }), () => text('85')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('average')], sink });
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /"result": 85/);
});

test('plan_update emits the plan for the UI', async () => {
  const { agent, events, sink } = setup();
  const steps = [
    { title: 'Read the rubric', status: 'done' },
    { title: 'Outline', status: 'in_progress' },
    { title: 'Draft' },
  ];
  const provider = new ScriptedProvider([() => toolCall('plan_update', { title: 'Essay', steps }), () => text('ok')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('help me plan')], sink });
  const plan = events.find((e) => e.type === 'plan');
  assert.deepEqual(plan, {
    type: 'plan',
    title: 'Essay',
    steps: [
      { title: 'Read the rubric', status: 'done' },
      { title: 'Outline', status: 'in_progress' },
      { title: 'Draft', status: 'pending' },
    ],
  });
});

test('ask_user ends the turn with the question', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('ask_user', { question: 'Which course, ACG 2021 or MAC 2311?' }), () => text('never reached')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('plan my exam')], sink });
  assert.equal(result.status, 'done');
  assert.equal(result.awaitingUser, true);
  assert.equal(result.content, 'Which course, ACG 2021 or MAC 2311?');
  assert.equal(provider.requests.length, 1, 'no further model call');
  assert.ok(events.some((e) => e.type === 'delta' && e.text.includes('ACG 2021')));
  assert.equal(result.messages.at(-1)!.content, 'Which course, ACG 2021 or MAC 2311?');
});

test('scheduled runs cannot ask the user', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([() => toolCall('ask_user', { question: 'Which one?' }), () => text('decided myself')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('task')], sink, kind: 'scheduled' });
  assert.equal(result.content, 'decided myself');
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /Nobody can answer/);
});

test('notify emits a notification event; subagents do not get these tools', async () => {
  const { agent, events, sink } = setup();
  const provider = new ScriptedProvider([
    () => toolCall('notify', { title: 'Quiz tomorrow', body: 'ACG quiz at 9am', url: 'https://canvas.example.edu/x' }),
    () => toolCall('agent_delegate', { tasks: [{ goal: 'g' }] }, 'd1'),
    () => text('child'),
    () => text('done'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  assert.ok(events.some((e) => e.type === 'notify' && e.title === 'Quiz tomorrow'));
  const child = provider.requests.find((r) => r.messages[0]!.content.includes('helper agent'))!;
  const names = child.tools!.map((t) => t.name);
  assert.ok(names.includes('calc') && names.includes('plan_update'));
  assert.ok(!names.includes('ask_user') && !names.includes('notify'));
});

test('a tool can set its own timeout instead of the default', async () => {
  const sleep = (ms: number, signal: AbortSignal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))));
  });
  const slow = defineTool({ name: 'slow', description: 'd', parameters: { type: 'object', properties: {} }, sideEffect: 'none', async run(_a, ctx) { await sleep(120, ctx.signal); return 'ok'; } });
  const patient = defineTool({ ...slow, name: 'patient', timeoutMs: 1000 });
  const { engine, user: profile, sink } = setup({ tools: [slow, patient] });
  const agent = engine.forUser(profile, { limits: { toolTimeoutMs: 40 } });
  const provider = new ScriptedProvider([() => toolCall('slow', {}, 'a'), () => toolCall('patient', {}, 'b'), () => text('done')]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('go')], sink });
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /Timed out after 0s/);
  assert.equal(provider.requests[2]!.messages.at(-1)!.content, 'ok');
});

test('ask_user with options: the questions come back structured, and as text for the conversation', async () => {
  const { agent, events, sink } = setup();
  const questions = [
    { question: 'Which format do you want?', header: 'Format', options: [{ label: 'Flashcards (Recommended)', description: 'Quick review' }, { label: 'Practice quiz' }] },
    { question: 'Which chapters?', header: 'Chapters', multi_select: true, options: [{ label: 'Ch 4' }, { label: 'Ch 5' }, { label: 'Ch 6' }] },
  ];
  const provider = new ScriptedProvider([() => toolCall('ask_user', { questions }), () => text('never reached')]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('help me study')], sink });
  assert.equal(result.awaitingUser, true);
  assert.equal(result.questions?.length, 2);
  assert.deepEqual(result.questions?.[1], { question: 'Which chapters?', header: 'Chapters', multiSelect: true, options: [{ label: 'Ch 4' }, { label: 'Ch 5' }, { label: 'Ch 6' }] });
  assert.match(result.content, /\*\*Format:\*\* Which format do you want\?[\s\S]*- Flashcards \(Recommended\): Quick review[\s\S]*\(pick any\)/);
  assert.ok(events.some((e) => e.type === 'questions' && e.questions.length === 2));
  assert.equal(provider.requests.length, 1);
});

test('ask_user refuses questions the user could not answer well, so the model fixes them', async () => {
  const { agent, sink } = setup();
  const provider = new ScriptedProvider([
    () => toolCall('ask_user', { questions: [{ question: 'Pick one?', options: [{ label: 'Only one' }] }] }, 'a'),
    () => toolCall('ask_user', { questions: Array.from({ length: 5 }, () => ({ question: 'q?', options: [{ label: 'a' }, { label: 'b' }] })) }, 'b'),
    () => text('ok'),
  ]);
  await agent.run({ runId: 'r1', model: model(provider), history: [user('x')], sink });
  assert.match(provider.requests[1]!.messages.at(-1)!.content, /needs 2 to 4 options/);
  assert.match(provider.requests[2]!.messages.at(-1)!.content, /at most 4 questions/);
});

test('show_html puts pages in the result (max 3), only when the host can show them', async () => {
  const { agent, events, sink } = setup({ displays: ['html'] });
  const page = '<!doctype html><html><body><canvas id="c"></canvas><script>1+1</script></body></html>';
  const provider = new ScriptedProvider([
    () => [
      ...toolCall('show_html', { title: 'Projectile motion', html: page }, 'a'),
      ...toolCall('show_html', { title: 'Not html', html: 'just text' }, 'b'),
      ...toolCall('show_html', { title: 'Too big', html: `<p>${'x'.repeat(200_001)}</p>` }, 'c'),
    ],
    () => [...toolCall('show_html', { title: 'Two', html: page }, 'd'), ...toolCall('show_html', { title: 'Three', html: page }, 'e'), ...toolCall('show_html', { title: 'Four', html: page }, 'f')],
    () => text('Here it is.'),
  ]);
  const result = await agent.run({ runId: 'r1', model: model(provider), history: [user('show me')], sink });
  assert.deepEqual(result.displays?.map((d) => d.title), ['Projectile motion', 'Two', 'Three']);
  assert.equal(result.displays?.[0]?.content, page);
  assert.ok(!JSON.stringify(result.toolCalls).includes('<canvas'), 'tool cards show the title, not the page');
  const r = provider.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(r[1]!, /must be an HTML document/);
  assert.match(r[2]!, /too big/);
  assert.match(provider.requests[2]!.messages.at(-1)!.content, /At most 3 pages/);
  assert.ok(events.some((e) => e.type === 'display' && e.title === 'Projectile motion'));
  assert.ok(!setup().agent.tools().some((t) => t.name === 'show_html'), 'off unless the host shows pages');
});

test('the rules push tools, ask_user for questions and plan_update for long tasks, only when they exist', async () => {
  const { buildSystemPrompt } = await import('../src/agent/prompt.js');
  const base = { basePrompt: 'You are a test.', user: { id: 'u', name: 'Ana', language: 'en', timezone: 'UTC' }, skills: [], today: new Date('2026-10-16T12:00:00Z') } as never;
  const all = buildSystemPrompt({ ...(base as object), canUseTools: true, toolNames: new Set(['ask_user', 'plan_update']) } as never);
  assert.match(all, /not a chatbot that describes it/);
  assert.match(all, /call ask_user with options\. Never write the questions in your message/);
  assert.match(all, /call plan_update with the steps before you start/);
  const none = buildSystemPrompt({ ...(base as object), canUseTools: true, toolNames: new Set() } as never);
  assert.doesNotMatch(none, /ask_user|plan_update/);
  const noTools = buildSystemPrompt({ ...(base as object), canUseTools: false } as never);
  assert.doesNotMatch(noTools, /not a chatbot/);
});
