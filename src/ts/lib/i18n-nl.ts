import type {TranslationKey} from './i18n-en.js';

/**
 * The Dutch dictionary.
 *
 * Typed as a complete record of the English keys, so the typecheck fails until
 * every key has a Dutch string here. Wording is a first pass; a native speaker
 * reviews it before a release (see the i18n tickets).
 */
export const nl: Record<TranslationKey, string> = {
  'settings.tagline': 'Warm, helder, van jou.',
  'settings.version': 'Instellingen · Versie {version}',
  'settings.close': 'Sluiten',
  'settings.save': 'Opslaan',
  'settings.loading': 'Instellingen laden…',
  'settings.loadFailed': 'Instellingen konden niet worden geladen. Druk op Sluiten en probeer het opnieuw.',
  'settings.loadUnfinished': 'Instellingen zijn niet volledig geladen. Sluit het paneel en open het opnieuw.',
  'settings.runUser.checking': 'Uitvoeren als: controleren…',
  'settings.runUser.slow': 'Uitvoeren als: geen antwoord van Homebrew Channel (root)',
  'settings.runUser.unrooted': 'Uitvoeren als: onbekend (niet geroot / geen Homebrew Channel)',
  'settings.runUser.root': 'Uitvoeren als: {user} — app-scan beschikbaar',
  'settings.runUser.limited': 'Uitvoeren als: {user} — geen root, app-scan mogelijk beperkt',
  'settings.runUser.unknown': 'Uitvoeren als: onbekend',

  'settings.category.look': 'Weergave',
  'settings.category.look.sub': 'Profiel, achtergrond, klok, pictogrammen',
  'settings.category.music': 'Muziek',
  'settings.category.music.sub': 'Achtergrondmuziek en het volume',
  'settings.category.screensaver': 'Schermbeveiliging',
  'settings.category.screensaver.sub': '{brand} en tv-schermbeveiliging',
  'settings.category.apps': 'Apps',
  'settings.category.apps.sub': 'Vastgezette apps, apps toevoegen of importeren',
  'settings.category.inputs': 'Ingangen en zenders',
  'settings.category.inputs.sub': 'HDMI-ingangen, Live TV-zenders',
  'settings.category.weather': 'Weer',
  'settings.category.weather.sub': 'Verwachting en locatie',
  'settings.category.system': 'Systeem',
  'settings.category.system.sub': 'Volumeniveaus, Home-knop, opstarten, prestaties',
  'settings.category.tools': 'Hulpmiddelen',
  'settings.category.tools.sub': 'Back-up en herstellen, tv-controle, updates',

  'system.language': 'Taal',
  'system.language.auto': 'Automatisch',
  'system.language.en': 'English',
  'system.language.nl': 'Nederlands',
  'system.volumeAtHome': 'Volume in {brand}',
  'system.volumeOnLaunch': 'Volume bij starten van apps',
  'system.volume.dontChange': 'Niet wijzigen',
  'system.volumeHint': 'Systeemvolume van de tv (0–100). “Niet wijzigen” laat staan wat je met de afstandsbediening hebt ingesteld. Anders schakelt {brand} naar het eerste niveau als je terugkeert naar het beginscherm, en naar het tweede wanneer Netflix / HDMI / andere apps starten.',
  'system.perfMode': 'Prestatiemodus (tvs met weinig geheugen)',
  'system.perfModeHint': 'Zet het matglas uit en gebruikt achtergronden van 1920px. Met Langzame zoom aan (Weergave) staat het glas al uit terwijl de achtergrond beweegt.',
  'system.launchOnHome': 'Starten met de Home-knop',
  'system.launchOnHomeHint': 'Indien ingeschakeld opent een root-service {brand} zodra het standaard Home-scherm verschijnt. Een korte flits van het LG-beginscherm is normaal (de tv opent eerst Home; we kunnen de toets niet blokkeren zonder een aparte input-hook-app). Vereist een geroote tv + Homebrew Channel. Zet de schakelaar uit en weer aan en sla op na updates als het niet meer werkt.',
  'system.bootOnStart': 'Opstarten met de tv',
  'system.bootOnStartHint': 'Indien ingeschakeld start een root init.d-script {brand} nadat de tv aangaat. Vereist een geroote tv + Homebrew Channel (net als de Home-knop). Een korte vertraging bij het opstarten is normaal terwijl webOS start. Met Snel starten+ aan wordt de tv alleen uit stand-by gehaald en draait dit niet; zet het uit onder Algemeen → Apparaten → TV-beheer.',

  'music.usbScan.found.one': '{count} nummer gevonden — vink de nummers aan die je wilt afspelen.',
  'music.usbScan.found.other': '{count} nummers gevonden — vink de nummers aan die je wilt afspelen.'
};
