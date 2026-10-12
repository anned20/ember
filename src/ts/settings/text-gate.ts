/**
 * Text-field keyboard gate.
 *
 * webOS opens the on-screen keyboard as soon as a text input is focused, which
 * is painful when D-pad scrolling through Settings. Keep fields read-only until
 * the user presses OK/Select (or clicks), then unlock for editing. On blur,
 * re-lock so the next focus via arrows won't pop the keyboard again.
 *
 * The focus manager reads the gate state through these helpers, so they stay
 * re-exported from the Settings panel module (see settings.ts).
 */

const KEYBOARD_SCROLL_RESERVE = 420;

export function isSettingsTextField(el: Element | null): boolean {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  const t = String(input.type || 'text').toLowerCase();
  return t === 'text' || t === 'number' || t === 'search' || t === 'url' || t === 'password';
}

export function isEditingSettingsText(el: Element | null): boolean {
  if (!isSettingsTextField(el)) return false;
  const input = el as HTMLInputElement;
  return input.readOnly === false && input.dataset.tvEdit === '1';
}

export function beginSettingsTextEdit(el: Element | null): boolean {
  if (!isSettingsTextField(el)) return false;
  const input = el as HTMLInputElement;
  input.readOnly = false;
  input.dataset.tvEdit = '1';
  try { input.focus(); } catch (err) { /* ignore */ }
  // Some webOS builds only raise the keyboard after a click once editable.
  try { input.click(); } catch (err) { /* ignore */ }
  return true;
}

export function endSettingsTextEdit(el: Element | null): void {
  if (!isSettingsTextField(el)) return;
  const input = el as HTMLInputElement;
  input.readOnly = true;
  delete input.dataset.tvEdit;
}

function gateTextField(input: Element): void {
  const field = input as HTMLInputElement | HTMLTextAreaElement;
  if (!field || field.dataset.tvKeyboardGated === '1') return;
  field.dataset.tvKeyboardGated = '1';
  field.readOnly = true;

  field.addEventListener('blur', function () {
    endSettingsTextEdit(field);
  });

  // Magic Remote pointer: click should enter edit mode (same as OK).
  field.addEventListener('click', function (event) {
    if (field.readOnly) {
      event.preventDefault();
      beginSettingsTextEdit(field);
    }
  });
}

/** Gate every text field inside a scroll container and keep them in view. */
export function attachInputScrollHelpers(scrollContainer: HTMLElement | null): void {
  if (!scrollContainer) return;

  scrollContainer.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(function (input) {
    gateTextField(input);

    input.addEventListener('focus', function () {
      // Only scroll for keyboard when actually editing (Select pressed).
      if ((input as HTMLInputElement).readOnly) return;
      window.setTimeout(function () {
        const containerRect = scrollContainer.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const visibleBottom = containerRect.bottom - KEYBOARD_SCROLL_RESERVE;

        if (inputRect.bottom > visibleBottom) {
          scrollContainer.scrollTop += inputRect.bottom - visibleBottom + 32;
        } else if (inputRect.top < containerRect.top + 16) {
          scrollContainer.scrollTop -= containerRect.top + 16 - inputRect.top;
        }
      }, 320);
    });
  });
}
