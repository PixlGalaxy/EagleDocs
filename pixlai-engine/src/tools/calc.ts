/**
 * A small, safe arithmetic evaluator for the `calc` tool: numbers, + - * / % ^,
 * parentheses, unary minus, a few constants and functions. No `eval`, no
 * variables, no access to anything else, so model input can never run code.
 */

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: (x, digits = 0) => {
    const f = 10 ** digits;
    return Math.round(x * f) / f;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log: (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)),
  ln: Math.log,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  pow: Math.pow,
  avg: (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  sum: (...xs) => xs.reduce((a, b) => a + b, 0),
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const MAX_LENGTH = 500;

type Token = { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(input.slice(i));
      if (!match) throw new Error(`Unexpected "${ch}" at position ${i + 1}`);
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
    } else if (/[a-z_]/i.test(ch)) {
      const match = /^[a-z_][a-z0-9_]*/i.exec(input.slice(i))!;
      tokens.push({ kind: 'id', value: match[0].toLowerCase() });
      i += match[0].length;
    } else if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
    } else {
      throw new Error(`Unexpected "${ch}" at position ${i + 1}`);
    }
  }
  return tokens;
}

/** Evaluates `expression`; throws with a readable message on bad input. */
export function evaluate(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new Error('Expression is too long');
  const tokens = tokenize(expression.replace(/\*\*/g, '^'));
  let pos = 0;
  const peek = () => tokens[pos];
  const takeOp = (value: string) => {
    const t = peek();
    if (t?.kind === 'op' && t.value === value) {
      pos++;
      return true;
    }
    return false;
  };

  // expr := term (('+'|'-') term)*
  const expr = (): number => {
    let value = term();
    for (;;) {
      if (takeOp('+')) value += term();
      else if (takeOp('-')) value -= term();
      else return value;
    }
  };
  // term := power (('*'|'/'|'%') power)*
  const term = (): number => {
    let value = power();
    for (;;) {
      if (takeOp('*')) value *= power();
      else if (takeOp('/')) {
        const d = power();
        if (d === 0) throw new Error('Division by zero');
        value /= d;
      } else if (takeOp('%')) value %= power();
      else return value;
    }
  };
  // power := unary ('^' power)?   (right associative)
  const power = (): number => {
    const base = unary();
    return takeOp('^') ? base ** power() : base;
  };
  const unary = (): number => {
    if (takeOp('-')) return -unary();
    if (takeOp('+')) return unary();
    return primary();
  };
  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    pos++;
    if (t.kind === 'num') return t.value;
    if (t.kind === 'op' && t.value === '(') {
      const value = expr();
      if (!takeOp(')')) throw new Error('Missing ")"');
      return value;
    }
    if (t.kind === 'id') {
      // Own properties only: names like "constructor" must not reach Object.prototype.
      if (Object.hasOwn(CONSTANTS, t.value)) return CONSTANTS[t.value]!;
      const fn = Object.hasOwn(FUNCTIONS, t.value) ? FUNCTIONS[t.value] : undefined;
      if (!fn) throw new Error(`Unknown name "${t.value}"`);
      if (!takeOp('(')) throw new Error(`"${t.value}" needs parentheses`);
      const args: number[] = [];
      if (!takeOp(')')) {
        do args.push(expr());
        while (takeOp(','));
        if (!takeOp(')')) throw new Error('Missing ")"');
      }
      return fn(...args);
    }
    throw new Error(`Unexpected "${t.value}"`);
  };

  const result = expr();
  if (pos < tokens.length) throw new Error(`Unexpected "${String(tokens[pos]!.value)}"`);
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number');
  return result;
}
