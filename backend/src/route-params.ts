/**
 * Express 5 types route params as `string | string[]`, since a pattern may
 * repeat a name. None of ours do, so collapse it back to a single value.
 */
export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
