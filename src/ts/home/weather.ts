/**
 * Home-screen weather: today + the next 4 days from Open-Meteo (no API key).
 *
 * Ported from the Atmosphere Android app (android-weather): the same forecast
 * and geocoding endpoints, WMO code → condition mapping (WeatherIcons.kt),
 * condition glyphs (WeatherGlyph.kt, redrawn as SVG), place labels
 * (WeatherMapper.geocodingToLocation) and City of London default.
 */

import type {Config, WeatherConfig, WeatherLocation} from '@lib/types.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_KEY = 'lounge.weather.v1';
// Same staleness window as the Android app's cache.
const STALE_MS = 15 * 60 * 1000;
const CHECK_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const DAYS_SHOWN = 5; // today + 4 ahead
// A couple of spare days so a cached forecast still covers "today" + 4 after midnight.
const DAYS_REQUESTED = 7;

export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  name: 'City of London, UK',
  latitude: 51.5123,
  longitude: -0.0907,
  countryCode: 'GB'
};

export type WeatherCondition =
  | 'clear'
  | 'mainly-clear'
  | 'partly-cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder';

/** Options for createWeatherPanel. */
export interface WeatherPanelOptions {
  isVisible?: () => boolean;
}

/** Handle returned by createWeatherPanel. */
export interface WeatherPanelHandle {
  refresh(force?: boolean): Promise<void>;
  start(): void;
  stop(): void;
}

/** A rendered forecast day. */
interface WeatherDay {
  date: string;
  code: number;
  high: number;
  low: number;
  rain: number;
}

/** The cached forecast entry stored in localStorage. */
interface WeatherCache {
  location: WeatherLocation;
  fetchedAt: number;
  data: any;
}

/** A raw Open-Meteo geocoding result. */
interface GeocodeResult {
  latitude?: unknown;
  longitude?: unknown;
  name?: unknown;
  admin1?: unknown;
  country?: unknown;
  country_code?: unknown;
  population?: unknown;
}

/** A scored geocoding result before the top N are returned. */
interface PlaceSearchResult {
  place: WeatherLocation;
  prefix: number;
  population: number;
  index: number;
}

export function normalizeWeatherConfig(raw: unknown): WeatherConfig {
  const cfg = (raw && typeof raw === 'object' ? raw : {}) as {
    enabled?: unknown;
    units?: unknown;
    location?: unknown;
  };
  const loc = (cfg.location && typeof cfg.location === 'object' ? cfg.location : {}) as Partial<WeatherLocation>;
  const hasCoords = typeof loc.latitude === 'number' && typeof loc.longitude === 'number';
  return {
    enabled: cfg.enabled !== false,
    units: cfg.units === 'f' ? 'f' : 'c',
    location: hasCoords
      ? {
        name: loc.name || 'Selected location',
        latitude: loc.latitude as number,
        longitude: loc.longitude as number,
        countryCode: loc.countryCode || ''
      }
      : Object.assign({}, DEFAULT_WEATHER_LOCATION)
  };
}

// ── WMO code → condition (WeatherIcons.kt) ────────────────────────────────

export function conditionOf(code: number): WeatherCondition {
  switch (code) {
    case 0: return 'clear';
    case 1: return 'mainly-clear';
    case 2: return 'partly-cloudy';
    case 3: return 'overcast';
    case 45: case 48: return 'fog';
    case 51: case 53: case 55: case 56: case 57: return 'drizzle';
    case 61: case 63: case 65: case 66: case 67: case 80: case 81: case 82: return 'rain';
    case 71: case 73: case 75: case 77: case 85: case 86: return 'snow';
    case 95: case 96: case 99: return 'thunder';
    default: return 'partly-cloudy';
  }
}

export function conditionLabel(code: number, isDay?: boolean): string {
  const day = isDay !== false;
  switch (conditionOf(code)) {
    case 'clear': return day ? 'Clear' : 'Clear night';
    case 'mainly-clear': return day ? 'Mostly clear' : 'Mostly clear night';
    case 'partly-cloudy': return 'Partly cloudy';
    case 'overcast': return 'Overcast';
    case 'fog': return 'Fog';
    case 'drizzle': return 'Drizzle';
    case 'rain': return 'Rain';
    case 'snow': return 'Snow';
    case 'thunder': return 'Thunderstorm';
    default: return 'Partly cloudy';
  }
}

// ── Glyphs (WeatherGlyph.kt as SVG on a 100×100 canvas) ───────────────────

const SUN_YELLOW = '#FFD60A';
const SUN_ORANGE = '#FFB340';
const MOON_SILVER = '#E8EEF8';
const CLOUD_LIGHT = '#F2F5FA';
const CLOUD_MID = '#C5CDD8';
const RAIN_BLUE = '#64D2FF';
const SNOW_WHITE = '#E8F4FF';
const FOG_GRAY = '#B8C0CC';

let moonMaskSeq = 0;

function n(v: number): number {
  return Math.round(v * 100) / 100;
}

function line(x1: number, y1: number, x2: number, y2: number, color: string, width: number, opacity?: number): string {
  return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) +
    '" stroke="' + color + '" stroke-width="' + n(width) + '" stroke-linecap="round"' +
    (opacity != null && opacity < 1 ? ' stroke-opacity="' + n(opacity) + '"' : '') + '/>';
}

function circle(cx: number, cy: number, r: number, fill: string, extra?: string): string {
  return '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" fill="' + fill + '"' +
    (extra || '') + '/>';
}

function sun(cx: number, cy: number, r: number): string {
  let out = circle(cx, cy, r, SUN_YELLOW);
  const inner = r * 1.35;
  const outer = r * 1.95;
  const width = Math.max(r * 0.28, 1.2);
  for (let i = 0; i < 8; i += 1) {
    const a = (i * 45 - 90) * Math.PI / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    out += line(cx + dx * inner, cy + dy * inner, cx + dx * outer, cy + dy * outer, SUN_ORANGE, width);
  }
  return out;
}

function moon(cx: number, cy: number, r: number): string {
  // Crescent = disc minus an offset disc (Path.combine Difference in Compose).
  moonMaskSeq += 1;
  const id = 'lh-moon-' + moonMaskSeq;
  return '<mask id="' + id + '"><rect width="100" height="100" fill="#fff"/>' +
    circle(cx + r * 0.42, cy - r * 0.10, r * 0.88, '#000') + '</mask>' +
    circle(cx, cy, r, MOON_SILVER, ' mask="url(#' + id + ')"');
}

function cloud(cx: number, cy: number, scale: number, fill: string, opacity?: number): string {
  const w = 100 * scale;
  const h = w * 0.55;
  const left = cx - w / 2;
  const op = opacity != null && opacity < 1 ? ' fill-opacity="' + n(opacity) + '"' : '';
  return '<g' + op + '>' +
    circle(left + w * 0.28, cy, h * 0.55, fill) +
    circle(left + w * 0.50, cy - h * 0.12, h * 0.72, fill) +
    circle(left + w * 0.72, cy + h * 0.02, h * 0.50, fill) +
    '<rect x="' + n(left + w * 0.18) + '" y="' + n(cy - h * 0.05) + '" width="' + n(w * 0.64) +
    '" height="' + n(h * 0.55) + '" rx="' + n(h * 0.3) + '" fill="' + fill + '"/>' +
    '</g>';
}

function rainDrops(count: number, opacity: number): string {
  const stroke = 7;
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = 22 + 55 * t;
    const shift = i % 2 === 0 ? 0 : 6;
    out += line(x, 58 + shift, x - stroke * 0.4, 92 + shift, RAIN_BLUE, stroke, opacity);
  }
  return out;
}

function snowFlakes(): string {
  const r = 5.5;
  return [[30, 68], [50, 78], [70, 66], [42, 90]].map(function (p) {
    return circle(p[0], p[1], r, SNOW_WHITE) +
      line(p[0] - r * 1.5, p[1], p[0] + r * 1.5, p[1], SNOW_WHITE, r * 0.5) +
      line(p[0], p[1] - r * 1.5, p[0], p[1] + r * 1.5, SNOW_WHITE, r * 0.5);
  }).join('');
}

function bolt(): string {
  return '<path d="M50 48 L40 70 L52 70 L44 96 L68 64 L54 64 L64 48 Z" fill="' + SUN_YELLOW + '"/>';
}

function fog(): string {
  return [30, 50, 70].map(function (y, i) {
    const inset = i % 2 === 0 ? 0 : 8;
    return line(12 + inset, y, 88 - inset, y, FOG_GRAY, 9, 0.95 - i * 0.12);
  }).join('');
}

export function weatherGlyphSvg(code: number, isDay?: boolean): string {
  const day = isDay !== false;
  let body = '';
  switch (conditionOf(code)) {
    case 'clear':
      body = day ? sun(50, 50, 22) : moon(50, 50, 30);
      break;
    case 'mainly-clear':
      body = day
        ? sun(40, 36, 17) + cloud(62, 66, 0.48, CLOUD_LIGHT)
        : moon(38, 34, 20) + cloud(62, 68, 0.46, CLOUD_MID);
      break;
    case 'partly-cloudy':
      body = (day ? sun(30, 28, 14) : moon(30, 26, 16)) + cloud(56, 58, 0.74, CLOUD_LIGHT);
      break;
    case 'overcast':
      body = cloud(52, 42, 0.78, CLOUD_MID) + cloud(40, 58, 0.58, CLOUD_LIGHT, 0.88);
      break;
    case 'fog':
      body = fog();
      break;
    case 'drizzle':
      body = cloud(50, 34, 0.70, CLOUD_MID) + rainDrops(3, 0.7);
      break;
    case 'rain':
      body = cloud(50, 32, 0.72, CLOUD_MID) + rainDrops(4, 1);
      break;
    case 'snow':
      body = cloud(50, 32, 0.70, CLOUD_LIGHT) + snowFlakes();
      break;
    case 'thunder':
      body = cloud(50, 30, 0.70, CLOUD_MID) + bolt();
      break;
    default:
      body = cloud(56, 58, 0.74, CLOUD_LIGHT);
  }
  return '<svg class="weather-glyph" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    body + '</svg>';
}

// ── Network ───────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise(function (resolve, reject) {
    const timer: ReturnType<typeof setTimeout> = setTimeout(function () {
      reject(new Error('Weather request timed out'));
    }, ms);
    promise.then(function (value) {
      clearTimeout(timer);
      resolve(value);
    }, function (err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function getJson(url: string): Promise<any> {
  return withTimeout(fetch(url), FETCH_TIMEOUT_MS).then(function (res) {
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    return res.text();
  }).then(function (text) {
    return JSON.parse(text);
  });
}

function forecastUrl(location: WeatherLocation): string {
  return FORECAST_URL +
    '?latitude=' + encodeURIComponent(location.latitude) +
    '&longitude=' + encodeURIComponent(location.longitude) +
    '&timezone=auto' +
    '&current=temperature_2m,weather_code,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&forecast_days=' + DAYS_REQUESTED;
}

/** Lowercase, accent-free form for prefix matching ("Manče" → "mance"). */
export function foldPlaceText(s: unknown): string {
  let out = String(s || '');
  if (typeof out.normalize === 'function') {
    out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return out.toLowerCase();
}

const placeSearchCache: Record<string, WeatherLocation[]> = {};

/**
 * Place search for Settings (OpenMeteoGeocodingApi.search), also used for
 * type-ahead suggestions. Open-Meteo fuzzy-matches from 3 letters but orders
 * loosely ("manc" puts Manče, pop. 148, above Manchester), so names that
 * start with what was typed come first, then bigger places.
 */
export function searchPlaces(query: string, limit?: number): Promise<WeatherLocation[]> {
  const q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  const max = limit || 8;
  const key = foldPlaceText(q) + '|' + max;
  if (placeSearchCache[key]) return Promise.resolve(placeSearchCache[key]);
  const url = GEOCODE_URL + '?name=' + encodeURIComponent(q) +
    '&count=12&language=en&format=json';
  const folded = foldPlaceText(q);
  return getJson(url).then(function (data) {
    const payload = (data && typeof data === 'object' ? data : {}) as {results?: unknown};
    const results = Array.isArray(payload.results) ? payload.results as GeocodeResult[] : [];
    const places: PlaceSearchResult[] = results.filter(function (r) {
      return r && typeof r.latitude === 'number' && typeof r.longitude === 'number';
    }).map(function (r, index) {
      // WeatherMapper.geocodingToLocation: "Name, Region, Country" — the
      // region is dropped when it repeats the name ("Tokyo, Japan").
      let label = r.name || '';
      if (r.admin1 && r.admin1 !== r.name) label += ', ' + r.admin1;
      if (r.country) label += ', ' + r.country;
      return {
        place: {
          name: label as string,
          latitude: r.latitude as number,
          longitude: r.longitude as number,
          countryCode: (r.country_code as string) || ''
        },
        prefix: foldPlaceText(r.name).indexOf(folded) === 0 ? 0 : 1,
        population: (r.population as number) || 0,
        index: index
      };
    });
    places.sort(function (a, b) {
      return (a.prefix - b.prefix) || (b.population - a.population) || (a.index - b.index);
    });
    const out = places.slice(0, max).map(function (p) { return p.place; });
    placeSearchCache[key] = out;
    return out;
  });
}

// ── Cache ─────────────────────────────────────────────────────────────────

function sameLocation(a: WeatherLocation | null | undefined, b: WeatherLocation | null | undefined): boolean {
  return !!(a && b) &&
    Math.abs(a.latitude - b.latitude) < 0.001 &&
    Math.abs(a.longitude - b.longitude) < 0.001;
}

function readCache(): WeatherCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as WeatherCache : null;
  } catch (err) {
    return null;
  }
}

function writeCache(entry: WeatherCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch (err) { /* storage full / blocked — keep the in-memory copy */ }
}

// ── Rendering ─────────────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"]/g, function (c) {
    return HTML_ENTITIES[c];
  });
}

function formatTemp(celsius: unknown, units: string): string {
  if (typeof celsius !== 'number' || isNaN(celsius)) return '–';
  const value = units === 'f' ? celsius * 9 / 5 + 32 : celsius;
  return Math.round(value) + '°';
}

/** "YYYY-MM-DD" for right now at the forecast location. */
function locationToday(data: any): string {
  const offset = (data && typeof data.utc_offset_seconds === 'number') ? data.utc_offset_seconds : 0;
  return new Date(Date.now() + offset * 1000).toISOString().slice(0, 10);
}

function weekdayShort(isoDate: unknown): string {
  const parts = String(isoDate).split('-');
  const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

/** Town and country only: "Manchester, England, United Kingdom" → "Manchester, United Kingdom". */
function placeLabel(name: unknown): string {
  const parts = String(name || '').split(',').map(function (p) {
    return p.trim();
  }).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts[0] + ', ' + parts[parts.length - 1];
}

function rainChance(pct: unknown): string {
  // Mirror the Android list: only call out rain when it is a real chance.
  if (typeof pct !== 'number' || pct < 20) return '';
  return '<span class="weather-rain">' + Math.round(pct) + '%</span>';
}

function buildDays(data: any): {days: WeatherDay[]; isToday: boolean} {
  const daily = (data && data.daily) || {};
  const times = daily.time || [];
  let start = times.indexOf(locationToday(data));
  if (start < 0) start = 0;
  const out: WeatherDay[] = [];
  for (let i = start; i < times.length && out.length < DAYS_SHOWN; i += 1) {
    out.push({
      date: times[i],
      code: (daily.weather_code || [])[i],
      high: (daily.temperature_2m_max || [])[i],
      low: (daily.temperature_2m_min || [])[i],
      rain: (daily.precipitation_probability_max || [])[i]
    });
  }
  return {days: out, isToday: times[start] === locationToday(data)};
}

function renderPanel(el: HTMLElement | null, data: any, cfg: WeatherConfig): boolean {
  const built = buildDays(data);
  const days = built.days;
  if (!days.length) return false;
  moonMaskSeq = 0; // mask ids only need to be unique within one render
  const units = cfg.units;
  const today = days[0];
  const current = (data && data.current) || {};
  // Current conditions only make sense while the cache still covers today.
  const hasCurrent = built.isToday && typeof current.temperature_2m === 'number';
  const nowCode = hasCurrent ? current.weather_code : today.code;
  const nowIsDay = hasCurrent ? current.is_day !== 0 : true;

  // Place gets its own line across the panel so the country always fits.
  let html = '<div class="weather-place">' + escapeHtml(placeLabel(cfg.location.name)) + '</div>' +
    '<div class="weather-row">' +
    '<div class="weather-today">' +
    '<div class="weather-today-head">' +
      '<span class="weather-day-label">' + (built.isToday ? 'Today' : weekdayShort(today.date)) + '</span>' +
    '</div>' +
    '<div class="weather-today-main">' +
      weatherGlyphSvg(nowCode, nowIsDay) +
      '<span class="weather-now">' + formatTemp(hasCurrent ? current.temperature_2m : today.high, units) + '</span>' +
    '</div>' +
    '<div class="weather-today-detail">' +
      '<span class="weather-condition">' + escapeHtml(conditionLabel(nowCode, nowIsDay)) + '</span>' +
      '<span class="weather-hilo">H ' + formatTemp(today.high, units) +
        ' <span class="weather-low">L ' + formatTemp(today.low, units) + '</span>' +
        rainChance(today.rain) + '</span>' +
    '</div>' +
  '</div>';

  for (let i = 1; i < days.length; i += 1) {
    const d = days[i];
    html += '<div class="weather-day" aria-label="' + escapeHtml(weekdayShort(d.date) + ', ' +
      conditionLabel(d.code, true) + ', high ' + formatTemp(d.high, units) + ', low ' +
      formatTemp(d.low, units)) + '">' +
      '<span class="weather-day-label">' + weekdayShort(d.date) + '</span>' +
      weatherGlyphSvg(d.code, true) +
      '<span class="weather-high">' + formatTemp(d.high, units) + '</span>' +
      '<span class="weather-low">' + formatTemp(d.low, units) + '</span>' +
      rainChance(d.rain) +
    '</div>';
  }
  html += '</div>';

  if (!el) return false;
  el.innerHTML = html;
  return true;
}

export function createWeatherPanel(
  el: HTMLElement | null,
  getConfig: () => Config,
  options?: WeatherPanelOptions
): WeatherPanelHandle {
  const isVisible: () => boolean = (options && options.isVisible) || function () { return true; };
  let fetching: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function cfg(): WeatherConfig {
    return normalizeWeatherConfig(getConfig().weather);
  }

  function hide(): void {
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  }

  function paintFromCache(c: WeatherConfig): WeatherCache | null {
    const cache = readCache();
    if (!cache || !sameLocation(cache.location, c.location)) return null;
    return renderPanel(el, cache.data, c) ? cache : null;
  }

  function fetchNow(c: WeatherConfig): Promise<void> {
    if (fetching) return fetching;
    const location = c.location;
    fetching = getJson(forecastUrl(location)).then(function (data) {
      writeCache({location: location, fetchedAt: Date.now(), data: data});
      const latest = cfg();
      if (latest.enabled && sameLocation(latest.location, location) && renderPanel(el, data, latest)) {
        if (el) el.hidden = false;
      }
    }).catch(function (err: unknown) {
      // Keep whatever is on screen (cached forecast); stay hidden if nothing.
      const e = err as {message?: unknown} | null;
      console.warn('[weather]', e && e.message ? e.message : err);
    }).then(function () {
      fetching = null;
    });
    return fetching;
  }

  /** Repaint from cache and fetch when stale. `force` always re-fetches. */
  function refresh(force?: boolean): Promise<void> {
    if (!el) return Promise.resolve();
    const c = cfg();
    if (!c.enabled) {
      hide();
      return Promise.resolve();
    }
    const cache = paintFromCache(c);
    el.hidden = !cache;
    if (!cache) el.innerHTML = '';
    const stale = !cache || (Date.now() - (cache.fetchedAt || 0)) > STALE_MS;
    if (force || stale) return fetchNow(c);
    return Promise.resolve();
  }

  function start(): void {
    if (timer) return;
    // Periodic check: re-renders (rolls "Today" over at midnight) and refetches
    // when stale, only while Launch Home is on screen.
    timer = setInterval(function () {
      if (isVisible()) refresh(false);
    }, CHECK_MS);
  }

  return {
    refresh: refresh,
    start: start,
    stop: function () {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
