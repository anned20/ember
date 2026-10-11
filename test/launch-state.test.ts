import {describe, expect, it} from 'vitest';
import {createLaunchState} from '@lib/launch-state.js';

const SELF = 'org.webosbrew.lounge.launcher';

function obs(overrides: Partial<Parameters<ReturnType<typeof createLaunchState>['observeForeground']>[0]> = {}) {
  return Object.assign(
    {now: 10000, appId: 'netflix', visible: true, returningToLounge: false},
    overrides
  );
}

describe('createLaunchState', () => {
  it('is idle until a launch is noted', () => {
    const state = createLaunchState({selfAppId: SELF});
    expect(state.isPending()).toBe(false);
    expect(state.observeForeground(obs())).toBe('none');
  });

  it('watches a launch and pauses music once hidden', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.isPending()).toBe(true);
    expect(state.wentHiddenSinceLaunch()).toBe(false);
    expect(state.shouldPauseForLaunch(true)).toBe(true);

    state.noteHidden();
    expect(state.wentHiddenSinceLaunch()).toBe(true);
    expect(state.shouldPauseForLaunch(true)).toBe(true);
  });

  it('keeps music paused while backgrounded even with no launch in flight', () => {
    const state = createLaunchState({selfAppId: SELF});
    expect(state.shouldPauseForLaunch(false)).toBe(true);
    expect(state.shouldPauseForLaunch(true)).toBe(false);
  });

  it('does not recover before the ghost delay has passed', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.observeForeground(obs({now: 2000}))).toBe('none');
    expect(state.isPending()).toBe(true);
  });

  it('does not recover when the foreground app is us', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.observeForeground(obs({now: 10000, appId: SELF}))).toBe('none');
  });

  it('does not recover once our surface was backgrounded', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    state.noteHidden();
    expect(state.observeForeground(obs({now: 10000}))).toBe('none');
  });

  it('does not recover while not visible or already returning', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.observeForeground(obs({now: 10000, visible: false}))).toBe('none');
    expect(state.observeForeground(obs({now: 10000, returningToLounge: true}))).toBe('none');
  });

  it('closes an ordinary stuck app', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.observeForeground(obs({now: 10000, appId: 'com.example.viewer'}))).toBe('close');
  });

  it('re-asserts a native streaming app once, then waits', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.observeForeground(obs({now: 10000, appId: 'netflix'}))).toBe('reassert');
    expect(state.observeForeground(obs({now: 11000, appId: 'netflix'}))).toBe('none');
  });

  it('stops watching a launch after the window expires', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    expect(state.observeForeground(obs({now: 20000, appId: SELF}))).toBe('none');
    expect(state.isPending()).toBe(false);
  });

  it('treats a resume as resolving any launch in flight', () => {
    const state = createLaunchState({selfAppId: SELF});
    state.noteLaunch(1000);
    state.noteResume();
    expect(state.isPending()).toBe(false);
  });
});
