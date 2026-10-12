import {
  createHint,
  createOptionStepper,
  createSection,
  createTextField,
  createToggle,
  labeledControl
} from '@settings/components/index.js';
import {stepperField} from '@settings/settings-binding.js';
import {foldPlaceText, normalizeWeatherConfig, searchPlaces} from '@home/weather.js';
import type {PaneHandle, SettingsContext} from '@settings/pane.js';
import type {WeatherLocation} from '@lib/types.js';

// How long the place lookup may take before we call the TV offline.
const PLACE_LOOKUP_MS = 5000;
// A short pause after each keystroke so typing doesn't fire a request per key.
const PLACE_LOOKUP_DEBOUNCE_MS = 300;
const PLACE_RESULT_LIMIT = 6;
const SUGGESTION_FOCUS_INDEX = '1023';

const IDLE_HINT = 'Start typing a town or city — matching places appear as you type. ' +
  'Forecast from Open-Meteo (no account needed); needs the TV to be online. ' +
  'Untick Show weather to hide it — nothing is downloaded while it’s off.';

/** The Weather pane: show/hide, units, and the place type-ahead. */
export function createWeatherPane(): PaneHandle {
  return {
    build: function (ctx: SettingsContext): void {
      const section = createSection('Weather');

      const cfg = normalizeWeatherConfig(ctx.rawConfig.weather);
      let place: WeatherLocation = Object.assign({}, cfg.location);

      const enabledField = createToggle({
        label: 'Show weather',
        focusIndex: '1020',
        path: 'weather.enabled'
      });
      ctx.binder.bind(enabledField.field!);
      section.appendChild(enabledField.row);

      const unitsSelect = createOptionStepper({
        focusIndex: 1021,
        choices: [
          {value: 'c', label: '°C'},
          {value: 'f', label: '°F'}
        ]
      });
      ctx.binder.bind(stepperField(unitsSelect, 'weather.units', {
        parse: function (raw) { return raw === 'f' ? 'f' : 'c'; }
      }));
      section.appendChild(labeledControl('Temperature', unitsSelect));

      const placeHint = createHint('');
      function paintPlace(pending: boolean): void {
        placeHint.textContent = 'Location: ' + place.name +
          (pending ? ' — press Save to use it' : '');
      }
      paintPlace(false);
      section.appendChild(placeHint);

      const searchField = createTextField({
        label: 'Change location',
        focusIndex: '1022',
        placeholder: 'Start typing a place, e.g. tok',
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

      const status = createHint(IDLE_HINT);
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
        status.textContent = 'Press Save to show the weather for ' + chosen.name + '.';
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
          status.textContent = IDLE_HINT;
          return;
        }
        // Short pause so each keystroke doesn't fire a request.
        lookupTimer = setTimeout(function () {
          status.textContent = 'Looking up “' + query + '”…';
          ctx.withDeadline(searchPlaces(query, PLACE_RESULT_LIMIT), PLACE_LOOKUP_MS)
            .then(function (places) {
              if (seq !== lookupSeq) return; // a newer keystroke won
              if (!places) {
                status.textContent = 'Could not look up places — check the TV is online.';
                return;
              }
              renderSuggestions(places, query);
              status.textContent = places.length
                ? 'Close the keyboard, then press ↓ and OK to pick a place (or point and click).'
                : 'No places match “' + query + '” — check the spelling.';
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
