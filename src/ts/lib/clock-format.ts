/**
 * The clock's time, for the home screen and the screensaver: "18:30", or on
 * a 12-hour clock "6:30" with a smaller "PM" (Settings -> Look -> Clock
 * format). `timezone` is Settings -> Look -> Timezone ('' = the TV's own).
 */

import {activeLocale, t} from './i18n.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function clockParts(date: Date, timezone: string, hour12: boolean): {time: string; ampm: string} {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  if (timezone && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    try {
      const parts = new Intl.DateTimeFormat(activeLocale(), {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: false
      }).formatToParts(date);
      let hour = '';
      let minute = '';
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i].type === 'hour') hour = parts[i].value;
        if (parts[i].type === 'minute') minute = parts[i].value;
      }
      if (hour && minute) {
        hours = Number(hour) % 24;
        minutes = Number(minute);
      }
    } catch (err) {
      // Invalid timezone: the TV's own time.
    }
  }
  if (!hour12) return {time: hours + ':' + pad(minutes), ampm: ''};
  return {time: ((hours % 12) || 12) + ':' + pad(minutes), ampm: hours < 12 ? t('clock.am') : t('clock.pm')};
}

/** Show the time in `el`; a 12-hour clock gets a smaller AM/PM after it. */
export function setClockTime(el: HTMLElement, date: Date, timezone: string, hour12: boolean): void {
  const parts = clockParts(date, timezone, hour12);
  el.textContent = parts.time;
  if (parts.ampm) {
    const ampm = document.createElement('span');
    ampm.className = 'clock-ampm';
    ampm.textContent = parts.ampm;
    el.appendChild(ampm);
  }
}
