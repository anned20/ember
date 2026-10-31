import type {Config, DeepPartial} from '@lib/types.js';
import type {TranslationKey} from '@lib/i18n.js';

// The pickers render labelKey through t(); the ids are the stored values.
export const PROFILE_OPTIONS: Array<{id: string; labelKey: TranslationKey}> = [
  {id: 'default', labelKey: 'look.profile.default'},
  {id: 'night', labelKey: 'look.profile.night'},
  {id: 'cinema', labelKey: 'look.profile.cinema'}
];

const PROFILE_PRESETS: Record<string, DeepPartial<Config>> = {
  night: {
    // Keeps your wallpaper, just under a darker scrim. It used to force the
    // midnight gradient, so photos picked in Settings "reset" to Gradient.
    background: {
      overlayOpacity: 0.6
    },
    music: {
      volume: 0.08
    }
  },
  cinema: {
    background: {
      source: 'preset',
      mode: 'static',
      preset: 'midnight',
      overlayOpacity: 0.55
    },
    music: {
      enabled: false
    }
  }
};

function deepMerge<T>(target: unknown, source: unknown): T {
  const out: Record<string, unknown> = Object.assign({}, target);
  if (!source || typeof source !== 'object') return out as T;

  for (const key of Object.keys(source as Record<string, unknown>)) {
    const value = (source as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function getProfileOverrides(config: Config): DeepPartial<Config> {
  const profileId = (config && config.profile) || 'default';
  if (profileId === 'default') return {};

  const custom = (config && config.profiles && config.profiles[profileId]) || {};
  const preset = PROFILE_PRESETS[profileId] || {};
  return deepMerge<DeepPartial<Config>>(preset, custom);
}

export function applyActiveProfile(config: Config): Config {
  const base = deepMerge<Config>({}, config);
  const overrides = getProfileOverrides(config);
  return deepMerge<Config>(base, overrides);
}