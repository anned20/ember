import {normalizeBackgroundConfig} from '@background/backgrounds.js';
import {applyActiveProfile} from '@config/profiles.js';
import {APP_VERSION} from '@lib/version.js';
import {BRAND} from '@lib/brand.js';
import {activity} from '@lib/activity.js';
import type {Config} from '@lib/types.js';

/**
 * Settings -> TV check: one line about Launch Home itself. It heads the text
 * on screen and is saved in the report file too.
 */
export function tvCheckHead(config: Config): string {
  const launcher = (config && config.launcher) || ({} as Config['launcher']);
  const bg = normalizeBackgroundConfig(applyActiveProfile(config).background);
  const chrome = (String(navigator.userAgent).match(/Chrome\/(\d+)/) || [])[1] || '?';
  return BRAND.name + ' ' + APP_VERSION +
    ' | perf ' + (launcher.perfMode ? 'on' : 'off') +
    ' | wallpaper ' + bg.source + (bg.kenBurns ? ' + slow zoom' : '') +
    ' | profile ' + ((config && config.profile) || 'default') +
    ' | Home button ' + (launcher.launchOnHome ? 'on' : 'off') +
    ' | boot ' + (launcher.bootOnStart ? 'on' : 'off') +
    ' | ' + (window.devicePixelRatio || 1) + 'x, Chrome ' + chrome;
}

/**
 * Settings -> TV check: watch Launch Home itself while the check opens TV
 * Settings over it. Counts only the moments something else has the remote
 * (TV Settings), and shows whether Launch Home got in the way: relaunching or
 * bringing itself back, taking focus, or still animating underneath.
 */
export function startLauncherProbe() {
  const start = Object.assign({}, activity);
  const t0 = Date.now();
  let away = 0;
  let awayPaused = 0;
  let awayAnims = 0;
  let awayFrames = 0;
  let running = true;
  function frame() {
    if (!running) return;
    if (!document.hasFocus()) awayFrames += 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const timer = setInterval(function () {
    if (document.hasFocus()) return;
    away += 1;
    if (document.body.classList.contains('app-inactive')) awayPaused += 1;
    const anims = document.getAnimations
      ? document.getAnimations().filter(function (a) { return a.playState === 'running'; }).length
      : 0;
    if (anims > awayAnims) awayAnims = anims;
  }, 500);
  return {
    stop: function () {
      running = false;
      clearInterval(timer);
      const newSeen = Math.min(activity.foregroundSeq - start.foregroundSeq, activity.foreground.length);
      const seen = newSeen > 0 ? activity.foreground.slice(-newSeen).join(', ') : 'nothing new';
      const counts = 'relaunched ' + (activity.relaunches - start.relaunches) +
        ', back from home ' + (activity.returns - start.returns) +
        ', closed apps ' + (activity.closes - start.closes) +
        ', took focus ' + (activity.reclaims - start.reclaims);
      const under = away > 0
        ? 'under TV Settings ' + Math.round(away / 2) + ' s: paused ' +
          Math.round(100 * awayPaused / away) + '%, animations up to ' + awayAnims +
          ', ' + Math.round(awayFrames / (away / 2)) + ' frames/s'
        : 'never lost focus to TV Settings';
      return BRAND.name + ' during the check: ' + counts + ' | ' + under +
        ' | foreground seen: ' + seen + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)';
    }
  };
}

/**
 * Settings -> TV check text: the Launch Home line, then the summary part of
 * the root script's report (its details stay in /tmp).
 */
export function tvCheckSummary(report: string, head: string): string {
  const text = String(report || '');
  const cut = text.indexOf('=== details ===');
  return head + '\n' + (cut >= 0 ? text.slice(0, cut) : text).trim();
}
