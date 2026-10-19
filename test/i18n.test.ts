import {afterEach, describe, expect, it, vi} from 'vitest';
import {activeLanguage, activeLocale, detectLanguage, setLanguage, t, tn} from '@lib/i18n.js';
import {de} from '@lib/i18n-de.js';
import {en} from '@lib/i18n-en.js';
import {fr} from '@lib/i18n-fr.js';
import {nl} from '@lib/i18n-nl.js';

/** Report a TV language (and preference list) to the detector. */
function withTvLanguages(languages: string[], language?: string): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language !== undefined ? language : (languages[0] || ''));
}

afterEach(() => {
  vi.restoreAllMocks();
  setLanguage('en');
});

describe('language detection', () => {
  it('reads the TV language when the setting is Automatic', () => {
    withTvLanguages(['nl-NL']);
    setLanguage('auto');
    expect(activeLanguage()).toBe('nl');

    withTvLanguages(['de-DE']);
    setLanguage('auto');
    expect(activeLanguage()).toBe('de');

    withTvLanguages(['fr-FR']);
    setLanguage('auto');
    expect(activeLanguage()).toBe('fr');

    withTvLanguages(['en-GB']);
    setLanguage('auto');
    expect(activeLanguage()).toBe('en');
  });

  it('treats every nl language as Dutch', () => {
    ['nl', 'nl-NL', 'nl-BE', 'NL-nl'].forEach(function (tag) {
      withTvLanguages([tag]);
      expect(detectLanguage()).toBe('nl');
    });
  });

  it('treats every de language as German', () => {
    ['de', 'de-DE', 'de-AT', 'de-CH', 'DE-de'].forEach(function (tag) {
      withTvLanguages([tag]);
      expect(detectLanguage()).toBe('de');
    });
  });

  it('treats every fr language as French', () => {
    ['fr', 'fr-FR', 'fr-BE', 'fr-CA', 'FR-fr'].forEach(function (tag) {
      withTvLanguages([tag]);
      expect(detectLanguage()).toBe('fr');
    });
  });

  it('falls back to English for any other language, or none at all', () => {
    ['en', 'en-GB', 'it-IT', 'af-ZA', ''].forEach(function (tag) {
      withTvLanguages(tag ? [tag] : [], tag);
      expect(detectLanguage()).toBe('en');
    });
  });

  it('follows the TV when the stored setting is unknown', () => {
    withTvLanguages(['nl-BE']);
    setLanguage('nonsense');
    expect(activeLanguage()).toBe('nl');
  });

  it('sets the document language to the resolved one', () => {
    setLanguage('nl');
    expect(document.documentElement.lang).toBe('nl');

    setLanguage('de');
    expect(document.documentElement.lang).toBe('de');

    setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('uses the language locale for dates', () => {
    setLanguage('de');
    expect(activeLocale()).toBe('de-DE');

    setLanguage('fr');
    expect(activeLocale()).toBe('fr-FR');

    setLanguage('nl');
    expect(activeLocale()).toBe('nl-NL');

    setLanguage('en');
    expect(activeLocale()).toBe('en-GB');
  });
});

describe('translation', () => {
  it('looks a key up in the active language', () => {
    setLanguage('en');
    expect(t('settings.save')).toBe('Save');

    setLanguage('nl');
    expect(t('settings.save')).toBe('Opslaan');

    setLanguage('de');
    expect(t('settings.save')).toBe('Speichern');

    setLanguage('fr');
    expect(t('settings.save')).toBe('Enregistrer');
  });

  it('fills {name} placeholders', () => {
    setLanguage('en');
    expect(t('settings.version', {version: '1.2.3'})).toBe('Settings · Version 1.2.3');

    setLanguage('nl');
    expect(t('settings.version', {version: '1.2.3'})).toBe('Instellingen · Versie 1.2.3');
  });

  it('leaves a placeholder alone when its parameter is missing', () => {
    expect(t('settings.version')).toBe('Settings · Version {version}');
  });

  it('picks the one form for one and the other for the rest', () => {
    setLanguage('en');
    expect(tn('music.usbScan.found', 1)).toBe('1 track found — tick the ones to play.');
    expect(tn('music.usbScan.found', 3)).toBe('3 tracks found — tick the ones to play.');
    expect(tn('screensaver.minutes', 1)).toBe('1 minute');
    expect(tn('screensaver.seconds', 30)).toBe('30 seconds');
    expect(tn('apps.found', 1)).toBe('Found 1 app.');
    expect(tn('apps.found', 4)).toBe('Found 4 apps.');
    expect(tn('apps.showInstalled', 2)).toBe('Show installed apps (2)');

    setLanguage('nl');
    expect(tn('music.usbScan.found', 1)).toBe('1 nummer gevonden. Vink aan welke je wilt afspelen.');
    expect(tn('music.usbScan.found', 0)).toBe('0 nummers gevonden. Vink aan welke je wilt afspelen.');
    expect(tn('screensaver.minutes', 5)).toBe('5 minuten');
    expect(tn('screensaver.seconds', 1)).toBe('1 seconde');
    expect(tn('apps.lgAdded', 1)).toBe('1 app van het homescreen van LG toegevoegd, in de volgorde van LG, achter de apps die je al had. Verwijder of verplaats ze hierboven en druk op Opslaan om ze te bewaren.');

    setLanguage('de');
    expect(tn('apps.found', 1)).toBe('1 App gefunden.');
    expect(tn('apps.found', 4)).toBe('4 Apps gefunden.');
    expect(tn('screensaver.minutes', 5)).toBe('5 Minuten');

    setLanguage('fr');
    expect(tn('apps.found', 1)).toBe('1 appli trouvée.');
    expect(tn('apps.found', 0)).toBe('0 appli trouvée.');
    expect(tn('apps.found', 4)).toBe('4 applis trouvées.');
    expect(tn('screensaver.minutes', 5)).toBe('5 minutes');
  });

  it('has a string for every English key in every dictionary', () => {
    [nl, de, fr].forEach(function (dictionary) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
      expect(Object.values(dictionary).every(function (value) { return value.trim().length > 0; })).toBe(true);
    });
  });
});
