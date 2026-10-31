/** The message of a caught value; `catch` bindings are `unknown` since TS 4.4. */
export function errorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const message = (err as {message?: unknown}).message;
  return typeof message === 'string' ? message : '';
}

/** The name of a caught value: webOS rejects with `DOMException`, which is not always an `Error`. */
export function errorName(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const name = (err as {name?: unknown}).name;
  return typeof name === 'string' ? name : '';
}
