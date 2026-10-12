/** A createProviderPicker control: a div carrying the picker's own API. */
export interface ProviderPickerElement extends HTMLDivElement {
  value: string;
  setValue(value: string): void;
}

/** The AI assistant choices: a radiogroup of provider cards. */
export function createProviderPicker(focusIndex: number, onChange?: (value: string) => void): ProviderPickerElement {
  const wrap = document.createElement('div') as ProviderPickerElement;
  wrap.className = 'ai-provider-pick';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'AI assistant');

  function makeCard(value: string, name: string, sub: string, indexOffset: number): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-provider-card focusable';
    btn.dataset.focusIndex = String(focusIndex + indexOffset);
    btn.dataset.value = value;
    btn.setAttribute('role', 'radio');
    const title = document.createElement('span');
    title.className = 'ai-provider-card-name';
    title.textContent = name;
    const detail = document.createElement('span');
    detail.className = 'ai-provider-card-sub';
    detail.textContent = sub;
    btn.appendChild(title);
    btn.appendChild(detail);
    return btn;
  }

  const grokBtn = makeCard('xai', 'Grok', 'xAI · voice, chat, and spoken answers', 0);
  const gemBtn = makeCard('gemini', 'Gemini', 'Google · speech and chat answers', 1);
  const orBtn = makeCard('openrouter', 'OpenRouter', 'Many models · chat answers', 2);
  wrap.appendChild(grokBtn);
  wrap.appendChild(gemBtn);
  wrap.appendChild(orBtn);
  wrap.value = 'xai';

  function paint() {
    const v = wrap.value;
    grokBtn.classList.toggle('is-selected', v === 'xai');
    gemBtn.classList.toggle('is-selected', v === 'gemini');
    orBtn.classList.toggle('is-selected', v === 'openrouter');
    grokBtn.setAttribute('aria-checked', v === 'xai' ? 'true' : 'false');
    gemBtn.setAttribute('aria-checked', v === 'gemini' ? 'true' : 'false');
    orBtn.setAttribute('aria-checked', v === 'openrouter' ? 'true' : 'false');
  }

  function select(value: string, silent?: boolean) {
    const next = (value === 'gemini' || value === 'openrouter') ? value : 'xai';
    const changed = wrap.value !== next;
    wrap.value = next;
    paint();
    if (!silent && changed && onChange) onChange(next);
  }

  grokBtn.addEventListener('click', function () { select('xai'); });
  gemBtn.addEventListener('click', function () { select('gemini'); });
  orBtn.addEventListener('click', function () { select('openrouter'); });
  wrap.setValue = function (value: string) { select(value, true); };
  paint();
  return wrap;
}
