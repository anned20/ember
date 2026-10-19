import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {conditionLabel, createWeatherPanel} from '@home/weather.js';
import {BRAND} from '@lib/brand.js';
import {setLanguage} from '@lib/i18n.js';
import type {Config, WeatherLocation} from '@lib/types.js';

const LOCATION: WeatherLocation = {
  name: 'Berlin',
  latitude: 52.5,
  longitude: 13.4,
  countryCode: 'DE'
};

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function forecast(): any {
  return {
    utc_offset_seconds: 0,
    current: {temperature_2m: 12, weather_code: 3, is_day: 1},
    daily: {
      time: [isoDay(0), isoDay(1), isoDay(2), isoDay(3), isoDay(4)],
      weather_code: [3, 63, 75, 0, 5],
      temperature_2m_max: [14, 13, 9, 11, 12],
      temperature_2m_min: [8, 7, 3, 5, 6],
      precipitation_probability_max: [10, 80, 60, 0, 30]
    }
  };
}

function config(): Config {
  return {weather: {enabled: true, units: 'c', location: LOCATION}} as unknown as Config;
}

/** A panel painted from a cache entry for `LOCATION`, so no request is made. */
async function paint(): Promise<HTMLElement> {
  localStorage.setItem(BRAND.storage.weather, JSON.stringify({
    location: LOCATION,
    fetchedAt: Date.now(),
    data: forecast()
  }));
  const el = document.createElement('section');
  document.body.appendChild(el);
  await createWeatherPanel(el, config).refresh();
  return el;
}

describe('the weather panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => setLanguage('en'));

  it('reads the forecast in Dutch, with the days spelled out for a screen reader', async () => {
    setLanguage('nl');
    const el = await paint();

    expect(el.querySelector('.weather-place')!.textContent).toBe('Berlin');
    expect(el.querySelector('.weather-day-label')!.textContent).toBe('Vandaag');
    expect(el.querySelector('.weather-condition')!.textContent).toBe('Bewolkt');
    expect(el.querySelector('.weather-now')!.textContent).toBe('12°');
    expect(el.querySelector('.weather-hilo')!.textContent).toContain('H 14°');
    expect(el.querySelector('.weather-hilo')!.textContent).toContain('L 8°');

    // Four days ahead, each with a Dutch short weekday and a Dutch summary.
    const days = el.querySelectorAll('.weather-day');
    expect(days).toHaveLength(4);
    const first = days[0];
    const weekday = first.querySelector('.weather-day-label')!.textContent;
    expect(weekday).toMatch(/^(ma|di|wo|do|vr|za|zo)$/);
    expect(first.getAttribute('aria-label')).toBe(weekday + ', Regen, max 13°, min 7°');
    expect(first.querySelector('.weather-rain')!.textContent).toBe('80%');
  });

  it('keeps the English wording when the language is English', async () => {
    const el = await paint();

    expect(el.querySelector('.weather-day-label')!.textContent).toBe('Today');
    expect(el.querySelector('.weather-condition')!.textContent).toBe('Overcast');
    expect(el.querySelectorAll('.weather-day')[0].getAttribute('aria-label'))
      .toMatch(/^[A-Z][a-z]{2}, Rain, high 13°, low 7°$/);
  });

  it('names every condition in the chosen language', () => {
    expect(conditionLabel(0, true)).toBe('Clear');
    expect(conditionLabel(0, false)).toBe('Clear night');
    expect(conditionLabel(95, true)).toBe('Thunderstorm');

    setLanguage('nl');
    expect(conditionLabel(0, true)).toBe('Helder');
    expect(conditionLabel(0, false)).toBe('Heldere nacht');
    expect(conditionLabel(95, true)).toBe('Onweer');
  });
});
