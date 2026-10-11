export interface AppRowOptions {
  title: string;
  icon?: string;
  /** The pinned list styles its rows and titles differently. */
  variant?: 'app' | 'pinned';
  missing?: boolean;
  /** Appended to the title, e.g. " — not installed on this TV". */
  titleSuffix?: string;
  /** Wire the icon `<img>` (src, error handling, lazy loading). */
  mountIcon?: (img: HTMLImageElement) => void;
}

export interface AppRow {
  row: HTMLDivElement;
  title: HTMLSpanElement;
}

/** An app row: optional icon, title, and whatever buttons the caller adds. */
export function createAppRow(options: AppRowOptions): AppRow {
  const pinned = options.variant === 'pinned';
  const row = document.createElement('div');
  row.className = pinned ? 'settings-pinned-row' : 'settings-app-row';
  if (options.missing) row.classList.add('is-missing');

  if (options.icon) {
    const img = document.createElement('img');
    img.className = 'settings-app-icon';
    img.alt = '';
    if (options.mountIcon) options.mountIcon(img);
    row.appendChild(img);
  }

  const title = document.createElement('span');
  if (pinned) title.className = 'settings-pinned-title';
  title.textContent = options.title + (options.titleSuffix || '');
  row.appendChild(title);

  return {row: row, title: title};
}
