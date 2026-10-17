import type { ChatImage, ResolvedModel } from 'pixlai-engine';

export const VISION_SYSTEM =
  'You describe pictures for Hawk, a study assistant that cannot see them. Be factual and specific; describe only what is ' +
  'visible and say when something is unclear instead of guessing.';

const DESCRIBE =
  'Describe this image so it can be discussed and found again later. Start with a one-line summary, then: the subject and ' +
  'any people or animals (what they wear, hold or do), objects, setting and background (windows, signs, screens), colors ' +
  'and style. Copy every piece of text exactly as written (math in LaTeX, tables as Markdown). Plain text, no preamble.';

export interface Seen {
  description: string;
  /** The answer to the question asked, when there was one. */
  answer?: string;
  tokensIn: number;
  tokensOut: number;
}

/** What to ask a vision model: the description, plus an answer to `question` after an ANSWER: line. */
export function visionPrompt(question: string | undefined): string {
  return question?.trim()
    ? `${DESCRIBE}\n\nThen, after a line with only "ANSWER:", answer this question about the image: ${question.trim()}`
    : DESCRIBE;
}

/** Splits a vision model's reply into the description and the answer. */
export function splitSeen(text: string, label: string): Pick<Seen, 'description' | 'answer'> {
  const [description, answer] = text.split(/\n\s*ANSWER:\s*/);
  if (!description?.trim()) throw new Error(`${label} returned no description`);
  return { description: description.trim(), ...(answer?.trim() && { answer: answer.trim() }) };
}

/** One call to a vision model outside the conversation: a general description, plus an answer to `question`. */
export async function describeImage(model: ResolvedModel, image: ChatImage, question: string | undefined, signal: AbortSignal): Promise<Seen> {
  const prompt = visionPrompt(question);
  let text = '';
  let tokensIn = 0;
  let tokensOut = 0;
  for await (const chunk of model.provider.stream({
    model: model.model,
    messages: [
      { role: 'system', content: VISION_SYSTEM },
      { role: 'user', content: prompt, images: [image] },
    ],
    reasoning: 'low',
    signal,
  })) {
    if (chunk.type === 'text') text += chunk.text;
    else if (chunk.type === 'usage') {
      tokensIn += chunk.inputTokens;
      tokensOut += chunk.outputTokens;
    }
  }
  return { ...splitSeen(text, model.label), tokensIn, tokensOut };
}
