import type { ModelChunk, ReasoningLevel } from 'pixlai-engine';
import type { Db } from '../../db/pool.js';
import { logger } from '../../logger.js';
import type { ModelCatalog, Resolution } from '../models/catalog.js';

const PROMPT =
  'Write a short title for a conversation that starts with the message below: 2 to 5 words, like a chat list ' +
  'title (e.g. "Accounting quiz prep", "Resumen del capítulo 4"). Use the language of the message. No quotes, no ' +
  'emoji, no ending punctuation. Reply with the title only.';

/** The model's reply as a title: first line, no reasoning, quotes, markdown or trailing punctuation; null if unusable. */
export function cleanTitle(raw: string): string | null {
  const text = raw
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!text) return null;
  const title = text
    .replace(/^(title|título)\s*:\s*/i, '')
    .replace(/^[#*>\-\s"'“”‘’`]+|["'“”‘’`*]+$/g, '')
    .replace(/[.!?。:;,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || title.length > 80) return null;
  return title.length > 60 ? `${title.slice(0, 57).trimEnd()}...` : title;
}

/**
 * Names a new chat from its first message with a quick model, in the
 * background: the chat already has a provisional title (its first words), and
 * this one replaces it only if the student has not renamed it meanwhile.
 */
export async function nameChat(
  deps: { db: Db; catalog: ModelCatalog },
  chat: { userId: string; chatId: string; modelRef: string | null; provisional: string },
  message: string,
): Promise<void> {
  if (!message.trim()) return;
  let candidates: Resolution[];
  try {
    candidates = await deps.catalog.quickModels(chat.userId, chat.modelRef);
  } catch (err) {
    logger.warn(`Naming chat ${chat.chatId}: no model (${(err as Error).message})`);
    return;
  }
  const errors: string[] = [];
  // One model may be down (a LAN server switched off): the next one names the chat.
  for (const { model, isStudyHawk } of candidates) {
    try {
      const text = await ask(model, message, reasoningFor(model.ref), (usage) => deps.catalog.recordUsage(chat.userId, isStudyHawk, usage.inputTokens, usage.outputTokens));
      const title = cleanTitle(text);
      if (!title) {
        errors.push(`${model.label}: no usable title`);
        continue;
      }
      await deps.db.query('UPDATE chats SET title = $2 WHERE id = $1 AND title = $3', [chat.chatId, title, chat.provisional]);
      return;
    } catch (err) {
      errors.push(`${model.label}: ${(err as Error).message}`);
    }
  }
  // The provisional title stays; naming is a nicety.
  logger.warn(`Naming chat ${chat.chatId} failed: ${errors.join('; ') || 'no model available'}`);
}

/** Quick models think as little as their provider allows: Ollama can switch it off, ChatGPT goes low, other APIs keep their default. */
function reasoningFor(ref: string): ReasoningLevel | undefined {
  if (ref.startsWith('studyhawk:')) return 'none';
  if (ref.startsWith('codex:')) return 'low';
  return undefined;
}

async function ask(model: Resolution['model'], message: string, reasoning: ReasoningLevel | undefined, onUsage: (u: { inputTokens: number; outputTokens: number }) => Promise<void>): Promise<string> {
  const request = {
    model: model.model,
    signal: AbortSignal.timeout(30_000),
    ...(reasoning && { reasoning }),
    messages: [
      { role: 'system' as const, content: PROMPT },
      { role: 'user' as const, content: message.slice(0, 2000) },
    ],
  };
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const chunk of model.provider.stream(request) as AsyncIterable<ModelChunk>) {
    if (chunk.type === 'text') text += chunk.text;
    if (chunk.type === 'usage') usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
    if (text.length > 400) break;
  }
  await onUsage(usage);
  return text;
}
