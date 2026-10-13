/**
 * Path utilities shared across the app. The prototype polyfills and the XHR
 * fetch shim that used to live here are gone: the supported floor is webOS 22
 * (Chromium 87), which has native `fetch`, `Array.find`, `Object.assign` and
 * `String.endsWith/padStart`.
 */

/**
 * Resolve a path relative to the packaged app root (index.html directory).
 * Absolute paths are returned as `file://` URLs.
 */
export function resolveAppUrl(relPath: string): string {
  if (!relPath) return '';
  const path = String(relPath);
  if (/^(https?:|data:|blob:|file:)/i.test(path)) return path;

  // Absolute filesystem path (USB / app dir without scheme).
  if (path.charAt(0) === '/') {
    return 'file://' + path;
  }

  try {
    if (typeof location !== 'undefined' && location.href) {
      const href = String(location.href).split('#')[0].split('?')[0];
      const base = href.replace(/[^/]*$/, '');
      const cleaned = path.replace(/^\.\//, '');
      return base + cleaned;
    }
  } catch (err) {
    // Fall through.
  }

  return path;
}

/**
 * Cache-bust a packaged asset URL so WAM does not keep a failed empty response
 * after an update. Remote (http/https), data: and blob: URLs are left alone;
 * `file://` URLs are versioned too on webOS 22+.
 */
export function withAssetVersion(url: string, version: string): string {
  if (!url || !version) return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'v=' + encodeURIComponent(String(version));
}
