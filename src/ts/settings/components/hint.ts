/** A `settings-hint` paragraph. `extraClass` carries the one-off modifiers. */
export function createHint(text: string, extraClass?: string): HTMLParagraphElement {
  const hint = document.createElement('p');
  hint.className = 'settings-hint' + (extraClass ? ' ' + extraClass : '');
  hint.textContent = text;
  return hint;
}
