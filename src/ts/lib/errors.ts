/** The message of a caught value; `catch` bindings are `unknown` since TS 4.4. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '';
}
