export interface MiniButtonOptions {
  label: string;
  focusIndex: number | string;
  /** Extra classes, after the default `settings-mini-btn focusable`. */
  className?: string;
  onClick?: (event: MouseEvent) => void;
  dataset?: Record<string, string>;
  ariaLabel?: string;
}

/** A `settings-mini-btn` button wired for focus and click. */
export function createMiniButton(options: MiniButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-mini-btn focusable' +
    (options.className ? ' ' + options.className : '');
  btn.dataset.focusIndex = String(options.focusIndex);
  if (options.ariaLabel) btn.setAttribute('aria-label', options.ariaLabel);
  if (options.dataset) {
    Object.keys(options.dataset).forEach(function (key) {
      btn.dataset[key] = options.dataset![key];
    });
  }
  btn.textContent = options.label;
  if (options.onClick) btn.addEventListener('click', options.onClick);
  return btn;
}
