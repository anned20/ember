import {afterEach, describe, expect, it, vi} from 'vitest';
import {activeLanguage, detectLanguage, setLanguage, t, tn} from '@lib/i18n.js';

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

  it('falls back to English for any other language, or none at all', () => {
    ['en', 'en-GB', 'de-DE', 'fr', 'af-ZA', ''].forEach(function (tag) {
      withTvLanguages(tag ? [tag] : [], tag);
      expect(detectLanguage()).toBe('en');
    });
  });

  it('follows the TV when the stored setting is unknown', () => {
    withTvLanguages(['nl-BE']);
    setLanguage('nonsense');
    expect(activeLanguage()).toBe('nl');
  });
});

describe('translation', () => {
  it('looks a key up in the active language', () => {
    setLanguage('en');
    expect(t('settings.save')).toBe('Save');

    setLanguage('nl');
    expect(t('settings.save')).toBe('Opslaan');
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
    expect(tn('music.usbScan.found', 1)).toBe('1 nummer gevonden — vink de nummers aan die je wilt afspelen.');
    expect(tn('music.usbScan.found', 0)).toBe('0 nummers gevonden — vink de nummers aan die je wilt afspelen.');
    expect(tn('screensaver.minutes', 5)).toBe('5 minuten');
    expect(tn('screensaver.seconds', 1)).toBe('1 seconde');
    expect(tn('apps.lgAdded', 1)).toBe('1 app van het homescreen van LG toegevoegd, in de volgorde van LG, achter de apps die je al had. Verwijder of verplaats ze hierboven en druk op Opslaan om ze te bewaren.');
  });
});
