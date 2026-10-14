export type ModelTier = 'fast' | 'smart' | 'code' | 'vision';
export const TIERS: ModelTier[] = ['fast', 'smart', 'code', 'vision'];

export interface RouteInput {
  /** The message being answered. */
  text: string;
  /** Characters in the recent history (last few turns). */
  historyChars: number;
  hasImage?: boolean;
  hasDocument?: boolean;
  /** The previous answer failed or the user asked to think harder. */
  escalate?: boolean;
}

export interface RouteDecision {
  tier: ModelTier;
  /** 0-100: how demanding the request looks. */
  score: number;
  reasons: string[];
}

const CODE = /\b(code|coding|bug|debug|error|stack ?trace|exception|python|java(script)?|typescript|c\+\+|sql|regex|function|compile|compil|script|programa|c[oó]digo|algoritmo|algorithm|leetcode|html|css|react|git)\b|```/i;
const SMART = /\b(explain|explica|compare|compara|plan|planea|essay|ensayo|analy[sz]e|analiza|summari[sz]e|resume|resumen|degree ?(map|works|audit)|mapa de carrera|schedule|horario|strategy|estrategia|why|por ?qu[eé]|proof|demuestra|research|investiga|outline|argument|thesis|tesis)\b/i;
const FAST = /^(hi|hey|hello|hola|buenas|gracias|thanks|thank you|ok|okay|vale|perfecto|great|genial|translate|traduce|qu[eé] hora|what time)\b/i;
const TOOLS = /\b(canvas|assignment|tarea|due|entrega|grade|nota|calificaci[oó]n|course|curso|degree ?works|announcement|anuncio|quiz|examen|exam)\b/i;
const ESCALATE = /\b(think (harder|more|again)|pi[eé]nsalo (mejor|bien)|try again|int[eé]ntalo de nuevo|that'?s wrong|est[aá] mal)\b/i;

/**
 * Deterministic tier choice for Auto mode. Plain rules on purpose: they are
 * cheap, predictable and testable, and the chip in the chat shows the result.
 */
export function routeTier(input: RouteInput): RouteDecision {
  const reasons: string[] = [];
  const text = input.text.trim();

  if (input.hasImage) return { tier: 'vision', score: 70, reasons: ['image attached'] };

  let score = 20;
  const length = text.length;
  if (length > 1500) {
    score += 30;
    reasons.push('long message');
  } else if (length > 400) {
    score += 15;
    reasons.push('medium message');
  }
  if (input.historyChars > 12_000) {
    score += 10;
    reasons.push('long conversation');
  }
  if (input.hasDocument) {
    score += 25;
    reasons.push('document attached');
  }
  if (TOOLS.test(text)) {
    score += 25;
    reasons.push('needs school data');
  }
  if (SMART.test(text)) {
    score += 25;
    reasons.push('reasoning task');
  }
  const escalate = input.escalate || ESCALATE.test(text);
  if (escalate) {
    score += 30;
    reasons.push('asked to think harder');
  }

  if (CODE.test(text)) {
    return { tier: 'code', score: Math.min(100, Math.max(score, 60)), reasons: [...reasons, 'programming'] };
  }
  if (FAST.test(text) && length < 120 && !escalate) {
    return { tier: 'fast', score: Math.min(score, 15), reasons: [...reasons, 'small talk'] };
  }
  score = Math.min(100, score);
  return { tier: score >= 45 ? 'smart' : 'fast', score, reasons };
}

/** The tier to fall back to when the chosen one has no model assigned. */
export const TIER_FALLBACK: Record<ModelTier, ModelTier[]> = {
  fast: ['smart', 'code'],
  smart: ['code', 'fast'],
  code: ['smart', 'fast'],
  vision: ['smart', 'fast'],
};
