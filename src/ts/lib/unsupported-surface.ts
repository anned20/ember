/**
 * The full-screen surface shown when the TV is below the supported platform
 * floor (webOS 22). It fails closed and visibly rather than running the home
 * screen degraded on an engine nothing is tested against.
 *
 * It reuses the app's overlay vocabulary (a full-screen scrim over a glass
 * card) rather than a framework.
 */
import {MIN_CHROMIUM_MAJOR, MIN_WEBOS_SDK} from '@luna/platform.js';

const SURFACE_ID = 'unsupported-tv';

/** Describe a detected webOS sdkVersion in the user's terms. */
export function describeDetectedPlatform(sdkVersion: number): string {
  if (sdkVersion > 0) return 'webOS sdk ' + sdkVersion;
  return 'an unrecognised platform';
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
  brand.textContent = 'Launch Home';

  const title = document.createElement('h1');
  title.id = 'unsupported-tv-title';
  title.className = 'unsupported-tv-title';
  title.textContent = 'This TV is too old';

  const body = document.createElement('p');
  body.className = 'unsupported-tv-body';
  body.appendChild(document.createTextNode('Launch Home needs webOS 22 or later. This TV reports '));
  const detectedEl = document.createElement('span');
  detectedEl.className = 'unsupported-tv-detected';
  detectedEl.textContent = detected;
  body.appendChild(detectedEl);
  body.appendChild(document.createTextNode('.'));

  const requirement = document.createElement('p');
  requirement.className = 'unsupported-tv-requirement';
  requirement.textContent =
    'Required: webOS 22 (sdk ' + MIN_WEBOS_SDK +
    ', Chromium ' + MIN_CHROMIUM_MAJOR + ') or later.';

  card.appendChild(brand);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(requirement);
  surface.appendChild(card);
  document.body.appendChild(surface);

  return surface;
}
