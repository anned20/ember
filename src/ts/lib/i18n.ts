import {de} from './i18n-de.js';
import {en} from './i18n-en.js';
import type {TranslationKey} from './i18n-en.js';
import {fr} from './i18n-fr.js';
import {nl} from './i18n-nl.js';

/**
 * The translation seam.
 *
 * Modules import `t` (and `tn`) straight from here; there is no i18n framework
 * and nothing is threaded through a context. The active language is a module
 * singleton resolved once at startup (`setLanguage` from the composition root),
 * so a lookup can never change language halfway through a render.
 *
 * Only viewer-facing text goes through here: console logs, Luna names, config
 * enum values, storage keys and user data (app titles, input names) stay as
 * they are.
 */

export type {TranslationKey};

/** A language Ember ships a dictionary for. */
export type LanguageCode = 'en' | 'nl' | 'de' | 'fr';

/**
 * The base key of a counted pair: the dictionary holds `X.one` and `X.other`,
 * and `tn` is called with `X`.
 */
type StripPluralSuffix<Key> = Key extends `${infer Base}.one` ? Base : never;

export type PluralKey = StripPluralSuffix<TranslationKey>;

/** The `{name}` placeholders a string can take. */
export type TranslationParams = Record<string, string | number>;

const DICTIONARIES: Record<LanguageCode, Record<TranslationKey, string>> = {en: en, nl: nl, de: de, fr: fr};

const LOCALES: Record<LanguageCode, string> = {en: 'en-GB', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR'};

let active: LanguageCode = 'en';

/**
 * The language the TV reports: Dutch, German or French when the TV's preferred
 * language starts with `nl`, `de` or `fr` (`nl`, `nl-NL`, `de-AT`, `fr-CA`, …),
 * English otherwise — including when there is no TV language at all.
 */
export function detectLanguage(): LanguageCode {
  const tags = typeof navigator === 'undefined'
    ? []
    : (navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language]);
  const preferred = String((tags && tags[0]) || '').toLowerCase();
  const prefix = preferred.slice(0, 2);
  return prefix === 'nl' || prefix === 'de' || prefix === 'fr' ? prefix : 'en';
}

/**
 * Set the active language from the `launcher.language` setting: one of the
 * shipped codes, anything else (the `'auto'` default, a value from an older or
 * newer config) follows the TV.
 */
export function setLanguage(setting: string | undefined): void {
  active = setting === 'en' || setting === 'nl' || setting === 'de' || setting === 'fr'
    ? setting
    : detectLanguage();
  // Assistive tech and the browser spell the page in the resolved language.
  if (typeof document !== 'undefined') document.documentElement.lang = active;
}

/** The language lookups currently use. */
export function activeLanguage(): LanguageCode {
  return active;
}

/**
 * The BCP 47 tag the date and time formatters use. English keeps `en-GB`, so
 * its dates read exactly as they did before the language setting existed.
 */
export function activeLocale(): string {
  return LOCALES[active];
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, function (whole, name: string) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
  });
}

/** The active language's text for `key`, with its `{name}` placeholders filled. */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const text = DICTIONARIES[active][key] || DICTIONARIES.en[key] || key;
  return interpolate(text, params);
}

/**
 * The counted form: `key` names a `…​.one` / `…​.other` pair and the active
 * language's plural rules pick one, with `{count}` (plus any other params)
 * filled in.
 */
export function tn(key: PluralKey, count: number, params?: TranslationParams): string {
  const form = (key + (pluralCategory(count) === 'one' ? '.one' : '.other')) as TranslationKey;
  return t(form, Object.assign({count: count}, params));
}

function pluralCategory(count: number): 'one' | 'other' {
  // Older webOS builds may have no Intl.PluralRules. Of the shipped languages
  // only French treats zero as singular; the rest split at one. CLDR's separate
  // `many` category (French millions) reads as `.other`, which suits every
  // counted string in the app.
  if (typeof Intl === 'undefined' || typeof Intl.PluralRules !== 'function') {
    return count === 1 || (active === 'fr' && count === 0) ? 'one' : 'other';
  }
  return new Intl.PluralRules(active).select(count) === 'one' ? 'one' : 'other';
}
