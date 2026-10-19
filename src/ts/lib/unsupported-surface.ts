/**
 * The full-screen surface shown when the TV is below the supported platform
 * floor (webOS 22). It fails closed and visibly rather than running the home
 * screen degraded on an engine nothing is tested against.
 *
 * It reuses the app's overlay vocabulary (a full-screen scrim over a glass
 * card) rather than a framework.
 */
import {MIN_CHROMIUM_MAJOR, MIN_WEBOS_SDK} from '@luna/platform.js';
import {BRAND} from '@lib/brand.js';
import {t} from '@lib/i18n.js';

const SURFACE_ID = 'unsupported-tv';

/** Describe a detected webOS sdkVersion in the user's terms. */
export function describeDetectedPlatform(sdkVersion: number): string {
  if (sdkVersion > 0) return t('unsupported.detected.webos', {sdk: sdkVersion});
  return t('unsupported.detected.unknown');
}

/**
 * Render (once) the "this TV is too old" surface and return it. Idempotent, so
 * a repeated call after a relaunch leaves one surface on screen.
 */
export function renderUnsupportedSurface(
  detected: string
): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(SURFACE_ID);
  if (existing) return existing;

  const surface = document.createElement('div');
  surface.id = SURFACE_ID;
  surface.className = 'unsupported-tv';
  surface.setAttribute('role', 'alertdialog');
  surface.setAttribute('aria-modal', 'true');
  surface.setAttribute('aria-labelledby', 'unsupported-tv-title');

  const card = document.createElement('div');
  card.className = 'unsupported-tv-card';

  const brand = document.createElement('div');
  brand.className = 'unsupported-tv-brand';
  brand.textContent = BRAND.name;

  const title = document.createElement('h1');
  title.id = 'unsupported-tv-title';
  title.className = 'unsupported-tv-title';
  title.textContent = t('unsupported.title');

  const body = document.createElement('p');
  body.className = 'unsupported-tv-body';
  // Split the sentence on the detected platform so it keeps its emphasis.
  const parts = t('unsupported.body', {brand: BRAND.name, detected: '\u0001'}).split('\u0001');
  body.appendChild(document.createTextNode(parts[0]));
  const detectedEl = document.createElement('span');
  detectedEl.className = 'unsupported-tv-detected';
  detectedEl.textContent = detected;
  body.appendChild(detectedEl);
  body.appendChild(document.createTextNode(parts[1] || ''));

  const requirement = document.createElement('p');
  requirement.className = 'unsupported-tv-requirement';
  requirement.textContent = t('unsupported.requirement', {
    sdk: MIN_WEBOS_SDK, chromium: MIN_CHROMIUM_MAJOR
  });

  card.appendChild(brand);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(requirement);
  surface.appendChild(card);
  document.body.appendChild(surface);

  return surface;
}
