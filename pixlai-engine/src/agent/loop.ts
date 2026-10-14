import type {
  BrowserPolicy,
  BrowserPort,
  Clock,
  EmbeddingPort,
  FetchPort,
  Logger,
  MemoryStore,
  RunStore,
  SandboxPort,
  ScheduleStore,
  SearchPort,
  SharedRagSource,
  SkillStore,
  TextExtractor,
  WorkspacePort,
} from '../ports.js';
import type { RunKind, SubagentOutcome, Tool, ToolContext } from '../tools/tool.js';
import { ToolRegistry } from '../tools/tool.js';
import type {
  ChatMessage,
  EngineEvent,
  EventSink,
  Limits,
  ResolvedModel,
  RunResult,
  ToolCallRequest,
  ToolCallView,
  UserProfile,
} from '../types.js';
import { compactIfNeeded } from './compact.js';
import { SUBAGENT_PROMPT } from './delegate.js';
import { buildSystemPrompt, toProviderMessages, wrapUntrusted } from './prompt.js';

/** Characters of one tool result kept in the context. */
const TOOL_RESULT_CHARS = 20_000;
const PREVIEW_CHARS = 300;
const MAX_PARALLEL_TOOLS = 8;
const ERROR_CHARS = 600;

const BUDGET_SUMMARY_REQUEST =
  'You have reached the limit of steps for this request. Do not call tools. Give your final answer now: ' +
  'what you did, what you found, and what is left to do.';

/** Sent once when a model returns nothing at all (often a long tool call the server could not parse). */
const EMPTY_REPLY_NUDGE =
  'Your last reply arrived empty. If you meant to call a tool, call it again with valid JSON arguments (keep very long ' +
  'code shorter or split it into steps); otherwise write your answer.';

export interface Services {
  runs: RunStore;
  memory: MemoryStore;
  skills: SkillStore;
  schedules: ScheduleStore;
  clock: Clock;
  logger: Logger;
  workspace?: WorkspacePort;
  extractor?: TextExtractor;
  embeddings?: EmbeddingPort;
  sharedRags?: SharedRagSource;
  sandbox?: SandboxPort;
  search?: SearchPort;
  fetcher?: FetchPort;
  browser?: BrowserPort;
  browserPolicy?: BrowserPolicy;
}

/** Shared by a run and all its subagents. */
interface Budget {
  inputTokens: number;
  outputTokens: number;
}

export interface LoopInput {
  services: Services;
  basePrompt: string;
  user: UserProfile;
  limits: Limits;
  host: Record<string, unknown>;
  tools: ToolRegistry;
  runId: string;
  kind: RunKind;
  depth: number;
  model: ResolvedModel;
  /** Earlier conversation, oldest first, ending with the message to answer. No system message. */
  history: ChatMessage[];
  sink: EventSink;
  signal: AbortSignal;
  extraInstructions?: string;
  budget?: Budget;
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > ERROR_CHARS ? `${message.slice(0, ERROR_CHARS)}...` : message;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 1) ?? 'null';
  } catch {
    return String(value);
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated: ${text.length - max} more characters]` : text;
}

/** Rejects when `signal` aborts; used to bound tool calls. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** Consecutive parallel-safe calls form one batch; anything else runs alone, in order. */
function planBatches(calls: ToolCallRequest[], tools: ToolRegistry): ToolCallRequest[][] {
  const batches: ToolCallRequest[][] = [];
  let current: ToolCallRequest[] = [];
  for (const call of calls) {
    const safe = tools.get(call.name)?.parallelSafe === true;
    if (safe && current.length < MAX_PARALLEL_TOOLS) {
      current.push(call);
      continue;
    }
    if (current.length) batches.push(current);
    current = [];
    if (safe) current.push(call);
    else batches.push([call]);
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * One agent run: model, tools, model... until it answers without tools, the
 * step budget runs out, or it is cancelled. Steers are applied at safe points
 * (before each model call, after each tool batch) and cut a generation short
 * when they arrive mid-answer. Every tool call gets exactly one result.
 */
export async function runLoop(input: LoopInput): Promise<RunResult> {
  const { services, user, limits, tools, model, sink, signal, runId, depth } = input;
  const budget = input.budget ?? { inputTokens: 0, outputTokens: 0 };
  const emit = async (event: EngineEvent) => {
    await sink.emit(event);
  };

  const produced: ChatMessage[] = [];
  const toolViews: ToolCallView[] = [];
  let steps = 0;
  let finalText = '';
  /** Set by ask_user: the run ends after this batch with the question as the answer. */
  let question: string | null = null;

  /** Ends a run that did not finish normally, telling the sink first. */
  const finish = async (status: 'failed' | 'cancelled', error?: string): Promise<RunResult> => {
    await sink.emit({ type: 'status', status });
    return result(status, error);
  };

  const result = (status: RunResult['status'], error?: string): RunResult => ({
    status,
    content: finalText,
    messages: produced,
    toolCalls: toolViews,
    usage: { inputTokens: budget.inputTokens, outputTokens: budget.outputTokens, steps },
    ...(error && { error }),
  });

  try {
    await emit({ type: 'status', status: 'running' });
    if (depth === 0) await emit({ type: 'model', model_ref: model.ref, model_label: model.label });

    const canUseTools = model.supportsTools && tools.list().length > 0;
    const latestUser = [...input.history].reverse().find((m) => m.role === 'user')?.content ?? '';
    const [memories, skills, workspaceNote, sandboxNote] = await Promise.all([
      input.kind === 'subagent' ? Promise.resolve([]) : services.memory.forPrompt(user.id, latestUser, 20),
      input.kind === 'subagent' || !canUseTools ? Promise.resolve([]) : services.skills.list(user.id),
      canUseTools && services.workspace ? services.workspace.describe(user.id) : Promise.resolve(undefined),
      // Must be cheap: the host answers from its config, it does not start a sandbox for this.
      canUseTools && services.sandbox && tools.get('code_run') ? services.sandbox.describe(user.id) : Promise.resolve(undefined),
    ]);
    const system = buildSystemPrompt({
      basePrompt: input.kind === 'subagent' ? SUBAGENT_PROMPT : input.basePrompt,
      user,
      memories,
      skills,
      canUseTools,
      extra:
        [workspaceNote && `## Workspace\n${workspaceNote}`, sandboxNote && `## Code sandbox\n${sandboxNote}`, input.extraInstructions]
          .filter(Boolean)
          .join('\n\n') || undefined,
      today: services.clock.now(),
    });
    if (!model.supportsTools && tools.list().length > 0 && depth === 0) {
      await emit({ type: 'notice', message: 'This model cannot use tools, so it answers from the conversation only.' });
    }

    let context: ChatMessage[] = [{ role: 'system', content: system }, ...input.history];
    const push = (message: ChatMessage) => {
      context.push(message);
      produced.push(message);
    };

    const applySteers = async (): Promise<boolean> => {
      if (depth > 0) return false;
      const steers = await services.runs.takeSteers(runId);
      for (const steer of steers) {
        push({ role: 'user', content: steer.content, steer: true });
        await emit({ type: 'steer_applied', id: steer.id, content: steer.content });
      }
      return steers.length > 0;
    };

    const toolSpecs = canUseTools
      ? tools.list().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
      : undefined;

    let emptyRetried = false;
    let nudge: string | null = null;
    for (;;) {
      if (signal.aborted) return finish('cancelled');
      await applySteers();

      const outOfSteps = steps >= limits.maxSteps;
      const outOfTokens = limits.maxTokens > 0 && budget.inputTokens + budget.outputTokens >= limits.maxTokens;
      const finalCall = outOfSteps || outOfTokens;
      steps++;

      const compacted = await compactIfNeeded(context, model, signal);
      context = compacted.messages;

      // A steer arriving while the model writes cuts this answer short.
      const attempt = new AbortController();
      const onCancel = () => attempt.abort(signal.reason);
      signal.addEventListener('abort', onCancel, { once: true });
      let steered = false;
      const stopWatching =
        depth === 0
          ? services.runs.watchSteers(runId, () => {
              steered = true;
              attempt.abort(new Error('steer'));
            })
          : () => undefined;

      let text = '';
      const calls: ToolCallRequest[] = [];
      try {
        const request = {
          model: model.model,
          messages: toProviderMessages(
            finalCall
              ? [...context, { role: 'user' as const, content: BUDGET_SUMMARY_REQUEST }]
              : nudge
                ? [...context, { role: 'user' as const, content: nudge }]
                : context,
          ),
          ...(toolSpecs && !finalCall && { tools: toolSpecs }),
          signal: attempt.signal,
        };
        for await (const chunk of model.provider.stream(request)) {
          if (chunk.type === 'text') {
            text += chunk.text;
            await emit({ type: 'delta', text: chunk.text });
          } else if (chunk.type === 'tool_call') {
            calls.push(chunk.call);
          } else if (chunk.type === 'usage') {
            budget.inputTokens += chunk.inputTokens;
            budget.outputTokens += chunk.outputTokens;
            await emit({ type: 'usage', input_tokens: chunk.inputTokens, output_tokens: chunk.outputTokens });
          }
        }
      } catch (err) {
        if (signal.aborted) return finish('cancelled');
        if (!steered) throw err;
      } finally {
        signal.removeEventListener('abort', onCancel);
        stopWatching();
      }
      if (signal.aborted) return finish('cancelled');

      if (steered) {
        // Keep what the user already saw as context, then loop: the steer is applied at the top.
        await emit({ type: 'interrupted' });
        if (text) push({ role: 'assistant', content: `${text}\n[interrupted by the user's correction]` });
        continue;
      }

      nudge = null;
      if (calls.length === 0 && !text.trim() && !finalCall && !emptyRetried) {
        // Nothing at all came back: ask once more instead of ending the run with a blank answer.
        emptyRetried = true;
        nudge = EMPTY_REPLY_NUDGE;
        services.logger.warn(`Run ${runId}: the model returned an empty reply; asking it again`);
        continue;
      }

      if (calls.length === 0 || finalCall) {
        finalText = text;
        push({ role: 'assistant', content: text });
        await emit({ type: 'status', status: 'done' });
        return result('done');
      }

      push({ role: 'assistant', content: text, toolCalls: calls });
      for (const batch of planBatches(calls, tools)) {
        const outputs = await Promise.all(batch.map((call) => executeCall(call)));
        for (const output of outputs) push(output);
      }
      if (question !== null) {
        const asked: string = question;
        finalText = asked;
        await emit({ type: 'delta', text: asked });
        push({ role: 'assistant', content: asked });
        await emit({ type: 'status', status: 'done' });
        return { ...result('done'), awaitingUser: true };
      }
    }
  } catch (err) {
    const message = errorText(err);
    services.logger.error(`Run ${runId} failed: ${message}`, err);
    return finish('failed', message);
  }

  /** Runs one call (with approval when needed) and returns its tool message. */
  async function executeCall(call: ToolCallRequest): Promise<ChatMessage> {
    const view: ToolCallView = { id: call.id, name: call.name, args: call.args, status: 'running' };
    toolViews.push(view);
    const finish = async (status: ToolCallView['status'], content: string): Promise<ChatMessage> => {
      view.status = status;
      view.result_preview = content.slice(0, PREVIEW_CHARS);
      await emit({ type: 'tool_result', call: { ...view } });
      return { role: 'tool', toolCallId: call.id, name: call.name, content };
    };

    const tool = tools.get(call.name);
    if (!tool) {
      await emit({ type: 'tool_call', call: { ...view } });
      return finish('error', stringify({ error: `Tool "${call.name}" does not exist. Available: ${tools.list().map((t) => t.name).join(', ')}` }));
    }
    if (signal.aborted) return finish('error', stringify({ error: 'Skipped: the run was cancelled' }));

    const gateCtx = { user, runKind: input.kind, host: input.host, browser: services.browser, browserPolicy: services.browserPolicy, workspace: services.workspace };
    let gate: 'run' | 'approve' | { refuse: string } = 'run';
    if (tool.gate) {
      try {
        gate = await tool.gate(call.args, gateCtx);
      } catch (err) {
        await emit({ type: 'tool_call', call: { ...view } });
        return finish('error', stringify({ error: errorText(err) }));
      }
    }
    if (typeof gate === 'object') {
      await emit({ type: 'tool_call', call: { ...view } });
      return finish('rejected', stringify({ error: gate.refuse }));
    }

    if (tool.sideEffect === 'external' || gate === 'approve') {
      const described = (tool.describe ? await Promise.resolve(tool.describe(call.args, gateCtx)).catch(() => null) : null) ?? { summary: tool.name };
      const approval = await services.runs.createApproval({
        runId,
        userId: user.id,
        toolName: tool.name,
        args: call.args,
        summary: described.summary,
        details: described.details ?? {},
      });
      view.status = 'waiting_approval';
      await emit({ type: 'tool_call', call: { ...view } });
      await emit({
        type: 'approval_required',
        approval: { id: approval.id, tool_name: tool.name, summary: described.summary, details: described.details ?? {} },
      });
      await emit({ type: 'status', status: 'waiting_approval' });
      const decision = await services.runs.waitForApproval(approval.id, limits.approvalTimeoutMs, signal);
      if (signal.aborted) return finish('error', stringify({ error: 'Skipped: the run was cancelled' }));
      await emit({ type: 'status', status: 'running' });
      if (decision !== 'approved') {
        const why = decision === 'expired' ? 'did not answer in time' : 'rejected it';
        return finish('rejected', stringify({ error: `The user ${why}. Do not retry this action unless they ask.` }));
      }
      view.status = 'running';
    }
    await emit({ type: 'tool_call', call: { ...view } });

    const timeoutMs = tool.timeoutMs ?? limits.toolTimeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const toolSignal = AbortSignal.any([signal, timeout]);
    const ctx: ToolContext = {
      user,
      runId,
      signal: toolSignal,
      depth,
      limits,
      emit: (event) => void emit(event),
      memory: services.memory,
      skills: services.skills,
      schedules: services.schedules,
      workspace: services.workspace,
      extractor: services.extractor,
      embeddings: services.embeddings,
      sharedRags: services.sharedRags,
      sandbox: services.sandbox,
      search: services.search,
      fetcher: services.fetcher,
      browser: services.browser,
      browserPolicy: services.browserPolicy,
      complete: (system: string, prompt: string) => completeOnce(system, prompt, toolSignal),
      clock: services.clock,
      logger: services.logger,
      host: input.host,
      callId: call.id,
      runKind: input.kind,
      ...(depth === 0 && {
        askUser: (q: string) => {
          question = q;
        },
      }),
      ...(depth < limits.maxSubagentDepth && {
        spawnSubagent: (goal: string, index: number) => spawn(goal, index, call.id),
      }),
    };
    try {
      const value = await abortable(tool.run(call.args, ctx), toolSignal);
      let content = clip(stringify(value), TOOL_RESULT_CHARS);
      if (tool.untrusted) content = wrapUntrusted(tool.name, content);
      return finish('done', content);
    } catch (err) {
      if (timeout.aborted && !signal.aborted) {
        return finish('error', stringify({ error: `Timed out after ${Math.round(timeoutMs / 1000)}s` }));
      }
      return finish('error', stringify({ error: errorText(err) }));
    }
  }

  /** One standalone call to the run's model (no tools, no history), for tools like rag_ask. */
  async function completeOnce(system: string, prompt: string, signal: AbortSignal): Promise<string> {
    let text = '';
    for await (const chunk of model.provider.stream({
      model: model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      signal,
    })) {
      if (chunk.type === 'text') text += chunk.text;
      else if (chunk.type === 'usage') {
        budget.inputTokens += chunk.inputTokens;
        budget.outputTokens += chunk.outputTokens;
      }
    }
    return text.trim();
  }

  /** A child run with a fresh context, read-only tools and its events tagged for the parent. */
  async function spawn(goal: string, index: number, parentCallId: string): Promise<SubagentOutcome> {
    const childDepth = depth + 1;
    const childTools = tools.filter(
      (t: Tool) =>
        t.sideEffect === 'none' && !t.mainAgentOnly && (t.name !== 'agent_delegate' || childDepth < limits.maxSubagentDepth),
    );
    const child = await runLoop({
      ...input,
      tools: childTools,
      kind: 'subagent',
      depth: childDepth,
      history: [{ role: 'user', content: goal }],
      extraInstructions: `You are a helper at depth ${childDepth}.`,
      budget,
      sink: { emit: (event) => sink.emit({ type: 'subagent', parent_call_id: parentCallId, index, task: goal.slice(0, 200), event }) },
    });
    return {
      status: child.status,
      summary: child.status === 'done' ? child.content : `The helper ${child.status}: ${child.error ?? 'no answer'}`,
    };
  }
}
