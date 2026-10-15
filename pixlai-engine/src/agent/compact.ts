import type { ChatMessage, ModelChunk, ResolvedModel } from '../types.js';

/** Compact when the estimated prompt passes this share of the context window. */
export const COMPACT_THRESHOLD = 0.75;
/** Newest messages always kept verbatim. */
const KEEP_TAIL = 12;
/** Tool results newer than this many tool messages keep their full text. */
const KEEP_TOOL_OUTPUTS = 6;
const CLEARED = '[Old tool output cleared to save context space]';

export const SUMMARY_PREFIX =
  '[EARLIER CONVERSATION, SUMMARIZED FOR REFERENCE] Earlier turns were compacted to save space. ' +
  'Answer only the latest user message after this summary; your tools still work.\n\n';

/** Rough token count (4 characters per token): good enough to decide when to compact. */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length + 16;
    // Providers bill an image at roughly a thousand tokens; close enough for the window check.
    chars += (m.images?.length ?? 0) * 4000;
    for (const call of m.toolCalls ?? []) chars += call.name.length + JSON.stringify(call.args).length;
  }
  return Math.ceil(chars / 4);
}

/** Index where the kept tail starts: never between a tool call and its results. */
function tailStart(messages: ChatMessage[], from: number): number {
  let start = Math.max(from, messages.length - KEEP_TAIL);
  while (start > from && messages[start]!.role === 'tool') start--;
  return start;
}

async function summarize(model: ResolvedModel, messages: ChatMessage[], signal: AbortSignal): Promise<string> {
  const transcript = messages
    .map((m) => {
      const calls = m.toolCalls?.length ? ` [called ${m.toolCalls.map((c) => c.name).join(', ')}]` : '';
      return `${m.role.toUpperCase()}${calls}: ${m.content.slice(0, 4000)}`;
    })
    .join('\n\n')
    .slice(0, 160_000);
  const request = {
    model: model.model,
    signal,
    messages: [
      {
        role: 'system' as const,
        content:
          'Summarize this earlier part of a conversation between a user and an assistant so the assistant can continue. ' +
          'Keep: the user\'s goals and preferences, decisions made, facts and numbers found, work still pending. ' +
          'Drop greetings and repetition. Use short bullets. Max 400 words.',
      },
      { role: 'user' as const, content: transcript },
    ],
  };
  let text = '';
  for await (const chunk of model.provider.stream(request) as AsyncIterable<ModelChunk>) {
    if (chunk.type === 'text') text += chunk.text;
  }
  return text.trim();
}

/**
 * Compaction on demand (a "compact" button): summarizes everything but the
 * newest messages with the given model. `keepFrom` is where the kept messages
 * start in `history` (never between a tool call and its results); the host
 * stores the summary and sends it before them from then on. Returns null when
 * there is too little to compact.
 */
export async function compactHistory(
  history: ChatMessage[],
  model: ResolvedModel,
  signal: AbortSignal,
  keep = KEEP_TAIL,
): Promise<{ summary: string; keepFrom: number } | null> {
  let keepFrom = Math.max(0, history.length - keep);
  while (keepFrom > 0 && history[keepFrom]!.role === 'tool') keepFrom--;
  if (keepFrom < 2) return null;
  const summary = await summarize(model, history.slice(0, keepFrom), signal);
  if (!summary) throw new Error('The model returned no summary');
  return { summary: SUMMARY_PREFIX + summary, keepFrom };
}

/**
 * Keeps the provider-facing history under the window: first clears old tool
 * outputs (no model call), then summarizes the middle with the same model.
 * The first element (system prompt) and the newest messages are never touched.
 */
export async function compactIfNeeded(
  messages: ChatMessage[],
  model: ResolvedModel,
  signal: AbortSignal,
): Promise<{ messages: ChatMessage[]; compacted: boolean }> {
  const budget = model.contextWindow * COMPACT_THRESHOLD;
  if (estimateTokens(messages) <= budget) return { messages, compacted: false };

  // 1. Old tool outputs are the cheapest thing to drop.
  let toolSeen = 0;
  let pruned = [...messages];
  for (let i = pruned.length - 1; i > 0; i--) {
    const m = pruned[i]!;
    if (m.role !== 'tool') continue;
    toolSeen++;
    if (toolSeen > KEEP_TOOL_OUTPUTS && m.content.length > 200) pruned[i] = { ...m, content: CLEARED };
  }
  if (estimateTokens(pruned) <= budget) return { messages: pruned, compacted: true };

  // 2. Summarize everything between the system prompt and the tail.
  const start = tailStart(pruned, 1);
  if (start <= 1) return { messages: pruned, compacted: true };
  const middle = pruned.slice(1, start);
  let summary: string;
  try {
    summary = await summarize(model, middle, signal);
  } catch {
    summary = '';
  }
  if (!summary) summary = `(${middle.length} earlier messages were removed and could not be summarized.)`;
  pruned = [pruned[0]!, { role: 'user', content: SUMMARY_PREFIX + summary }, ...pruned.slice(start)];
  return { messages: pruned, compacted: true };
}
