import {
  createHint,
  createOptionStepper,
  createSection,
  createTextField,
  labeledControl
} from '@settings/components/index.js';
import {foldPlaceText, normalizeWeatherConfig, searchPlaces} from '@home/weather.js';
import {t} from '@lib/i18n.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import type {WeatherLocation} from '@lib/types.js';

// How long the place lookup may take before we call the TV offline.
const PLACE_LOOKUP_MS = 5000;
// A short pause after each keystroke so typing doesn't fire a request per key.
const PLACE_LOOKUP_DEBOUNCE_MS = 300;
const PLACE_RESULT_LIMIT = 6;
const SUGGESTION_FOCUS_INDEX = '1023';

/** The Weather pane: the card/inline/off style, units, and the place type-ahead. */
export function createWeatherPane(): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection(t('weather.section'));

      const cfg = normalizeWeatherConfig(ctx.rawConfig.weather);
      let place: WeatherLocation = Object.assign({}, cfg.location);

      const styleSelect = createOptionStepper({
        focusIndex: 1020,
        choices: [
          {value: 'card', label: t('weather.style.card')},
          {value: 'inline', label: t('weather.style.inline')},
          {value: 'off', label: t('weather.style.off')}
        ],
        path: 'weather.style',
        parse: function (raw) {
          return raw === 'inline' || raw === 'off' ? raw : 'card';
        },
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('weather.style'), styleSelect));

      const unitsSelect = createOptionStepper({
        focusIndex: 1021,
        choices: [
          {value: 'c', label: '°C'},
          {value: 'f', label: '°F'}
        ],
        path: 'weather.units',
        parse: function (raw) { return raw === 'f' ? 'f' : 'c'; },
        binder: ctx.binder
      });
      section.appendChild(labeledControl(t('weather.temperature'), unitsSelect));

      const placeHint = createHint('');
      function paintPlace(pending: boolean): void {
        placeHint.textContent = t('weather.location', {place: place.name}) +
          (pending ? t('weather.locationPending') : '');
      }
      paintPlace(false);
      section.appendChild(placeHint);

      const searchField = createTextField({
        label: t('weather.changeLocation'),
        focusIndex: '1022',
        placeholder: t('weather.placeholder'),
        autocomplete: 'off'
      });
      const searchInput = searchField.input;
      section.appendChild(searchField.row);

      // Type-ahead: matches appear under the field as you type ("tok" →
      // Tokyo, Japan). Close the keyboard, press Down, then OK to pick one.
      const suggestions = document.createElement('div');
      suggestions.className = 'settings-suggestions';
      suggestions.setAttribute('role', 'listbox');
      suggestions.hidden = true;
      section.appendChild(suggestions);

      const status = createHint(t('weather.idleHint'));
      section.appendChild(status);

      function clearSuggestions(): void {
        suggestions.innerHTML = '';
        suggestions.hidden = true;
      }

      // Bold the part of the place name that matches what was typed.
      function appendMatchHighlight(el: HTMLElement, label: string, query: string): void {
        const foldedLabel = foldPlaceText(label);
        const foldedQuery = foldPlaceText(query);
        if (foldedQuery && foldedLabel.length === label.length &&
            foldedLabel.indexOf(foldedQuery) === 0) {
          const strong = document.createElement('strong');
          strong.textContent = label.slice(0, foldedQuery.length);
          el.appendChild(strong);
          el.appendChild(document.createTextNode(label.slice(foldedQuery.length)));
        } else {
          el.textContent = label;
        }
      }

      let typed = '';
      let lookupSeq = 0;
      let lookupTimer: ReturnType<typeof setTimeout> | null = null;

      function pickPlace(chosen: WeatherLocation): void {
        if (lookupTimer !== null) clearTimeout(lookupTimer);
        lookupSeq += 1; // drop any lookup still in flight
        place = chosen;
        typed = chosen.name;
        searchInput.value = chosen.name;
        clearSuggestions();
        paintPlace(true);
        status.textContent = t('weather.pressSave', {place: chosen.name});
        ctx.focusControl(searchInput);
      }

      function renderSuggestions(places: WeatherLocation[], query: string): void {
        suggestions.innerHTML = '';
        places.forEach(function (found) {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'settings-suggestion focusable';
          option.dataset.focusIndex = SUGGESTION_FOCUS_INDEX;
          option.setAttribute('role', 'option');
          appendMatchHighlight(option, found.name, query);
          option.addEventListener('click', function () {
            pickPlace(found);
          });
          suggestions.appendChild(option);
        });
        suggestions.hidden = !places.length;
      }

      function lookUpPlaces(query: string): void {
        if (lookupTimer !== null) clearTimeout(lookupTimer);
        const seq = ++lookupSeq;
        if (query.length < 2) {
          clearSuggestions();
          status.textContent = t('weather.idleHint');
          return;
        }
        // Short pause so each keystroke doesn't fire a request.
        lookupTimer = setTimeout(function () {
          status.textContent = t('weather.lookingUp', {query: query});
          ctx.withDeadline(searchPlaces(query, PLACE_RESULT_LIMIT), PLACE_LOOKUP_MS)
            .then(function (places) {
              if (seq !== lookupSeq) return; // a newer keystroke won
              if (!places) {
                status.textContent = t('weather.lookupFailed');
                return;
              }
              renderSuggestions(places, query);
              status.textContent = places.length
                ? t('weather.choose')
                : t('weather.noPlaces', {query: query});
            });
        }, PLACE_LOOKUP_DEBOUNCE_MS);
      }

      // The TV keyboard doesn't always send `input`; watch every edit signal
      // and only react when the text actually changed.
      ['input', 'keyup', 'change', 'compositionend'].forEach(function (type) {
        searchInput.addEventListener(type, function () {
          const next = searchInput.value.trim();
          if (next === typed) return;
          typed = next;
          lookUpPlaces(next);
        });
      });

      // The place comes from the async place lookup, not a plain control.
      ctx.binder.hook(function (saved) {
        saved.weather.location = Object.assign({}, place);
      });

      ctx.panes.weather.appendChild(section);
    }
  };
}
