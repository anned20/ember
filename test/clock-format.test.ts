import {afterEach, describe, expect, it} from 'vitest';
import {clockParts, setClockTime} from '@lib/clock-format.js';
import {setLanguage, t} from '@lib/i18n.js';

const MORNING = new Date(2026, 0, 1, 6, 30);
const EVENING = new Date(2026, 0, 1, 18, 30);

afterEach(() => setLanguage('en'));

describe('the clock', () => {
  it('leaves a 24-hour clock unmarked, whatever the language', () => {
    expect(clockParts(EVENING, '', false)).toEqual({time: '18:30', ampm: ''});
    setLanguage('nl');
    expect(clockParts(EVENING, '', false)).toEqual({time: '18:30', ampm: ''});
  });

  it('marks a 12-hour clock in the chosen language', () => {
    expect(clockParts(MORNING, '', true)).toEqual({time: '6:30', ampm: 'AM'});
    expect(clockParts(EVENING, '', true)).toEqual({time: '6:30', ampm: 'PM'});

    setLanguage('nl');
    expect(clockParts(MORNING, '', true)).toEqual({time: '6:30', ampm: t('clock.am')});
    expect(clockParts(EVENING, '', true)).toEqual({time: '6:30', ampm: t('clock.pm')});
  });

  it('paints the marker into the element', () => {
    setLanguage('nl');
    const el = document.createElement('div');

    setClockTime(el, EVENING, '', true);

    expect(el.textContent).toBe('6:30' + t('clock.pm'));
    expect(el.querySelector('.clock-ampm')!.textContent).toBe(t('clock.pm'));
  });
});
