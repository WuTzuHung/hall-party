'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const calls = [], timers = [];
  const sandbox = { performance, setTimeout: fn => timers.push(fn), window: {}, location: { origin: 'http://localhost' } };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/screen.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export class BigScreen', 'globalThis.BigScreen = class BigScreen');
  vm.runInNewContext(source, sandbox);
  const s = Object.create(sandbox.BigScreen.prototype);
  Object.assign(s, { player: null, ready: false, state: null, muted: true, volume: 70, fade: 1, reported: {}, updateOverlay() {}, transition() {} });
  const p = { getIframe: () => ({ style: {} }), getVideoData: () => ({ video_id: s.state.id }),
    mute() { calls.push('mute'); p.muted = true; }, unMute() { calls.push('unMute'); p.muted = false; },
    isMuted: () => p.muted, getPlayerState: () => p.state, setVolume: v => calls.push(['volume', v]),
    playVideo: () => calls.push('playVideo'), unloadModule: name => calls.push(['unload', name]), state: 1, muted: true };
  const api = () => {
    sandbox.YT = sandbox.window.YT = { Player: function (id, config) { calls.push(['create', config.videoId]); p.config = config; return p; } };
  };
  const media = { mode: 'music', music: { track: { id: 'HYsz1hP0BFo', title: '' }, playing: true, position: 0, seq: 2 } };
  return { s, p, calls, timers, api, media };
}

test('API before admission waits for a valid video and creates only one player', () => {
  const { s, calls, api, media } = fixture(); api(); s.createPlayer();
  assert.equal(s.player, null); assert.deepEqual(calls, []);
  s.setMedia(media); s.setMedia(media);
  assert.deepEqual(calls, [['create', 'HYsz1hP0BFo']]);
});
test('media before API creates the player when the API callback arrives', () => {
  const { s, calls, api, media } = fixture(); s.setMedia(media);
  assert.equal(s.player, null); api(); s.createPlayer();
  assert.deepEqual(calls, [['create', 'HYsz1hP0BFo']]);
});
test('early sound intent does not unmute from the delayed ready callback', () => {
  const { s, p, calls, api, media } = fixture(); s.setSound(true); api(); s.setMedia(media);
  s.apply = () => {}; p.config.events.onReady();
  assert.equal(s.ready, true); assert.equal(s.isSoundOn(), false);
  assert.equal(calls.includes('unMute'), false);
});
test('sound gesture immediately unmutes and resumes, but respects server pause', () => {
  const { s, p, calls, api, media } = fixture(); api(); s.setMedia(media); s.ready = true;
  s.setSound(true); assert.deepEqual(calls.slice(-2), ['unMute', 'playVideo']); assert.equal(s.isSoundOn(), true);
  s.state.playing = false; calls.length = 0; s.setSound(true);
  assert.equal(calls.includes('unMute'), true); assert.equal(calls.includes('playVideo'), false);
  p.state = 2; assert.equal(s.isSoundOn(), true); // 管理員暫停時仍可把已開啟的聲音關掉
  s.state.playing = true; assert.equal(s.isSoundOn(), false); // 瀏覽器擋播不能宣稱已開聲音
});
test('fade and zone volume updates preserve a browser-imposed mute', () => {
  const { s, p, calls, api, media } = fixture(); api(); s.setMedia(media); s.ready = true; s.muted = false; s.fade = 0.5;
  s.applyVolume(); assert.equal(p.muted, true); assert.equal(s.isSoundOn(), false);
  assert.deepEqual(calls.at(-1), ['volume', 35]); assert.equal(calls.includes('unMute'), false);
});
test('autoplay block returns the button to pending and explicit mute is respected', () => {
  const { s, p, api, media } = fixture(); api(); s.setMedia(media); s.ready = true;
  let active; s.onSoundChange = on => { active = on; };
  s.setSound(true); assert.equal(active, true);
  p.config.events.onAutoplayBlocked(); assert.equal(active, false); assert.equal(p.muted, true);
  s.setSound(false); assert.equal(s.muted, true); assert.equal(active, false);
});

test('captions are disabled at readiness and again when a delayed module loads', () => {
  const { s, p, calls, api, media } = fixture(); api(); s.setMedia(media); s.apply = () => {};
  p.config.events.onApiChange();
  assert.equal(calls.some(c => c[0] === 'unload'), false);
  p.config.events.onReady();
  assert.deepEqual(calls.filter(c => c[0] === 'unload'), [['unload', 'captions']]);
  p.config.events.onApiChange();
  assert.equal(calls.filter(c => c[0] === 'unload').length, 2);
});

test('each playing event disables captions after switching videos, including live media', () => {
  const { s, p, calls, api, media } = fixture(); api(); s.setMedia(media); s.ready = true;
  for (const id of ['yKZ7re9MAy4', 'C3GouGa0noM']) {
    s.setState({ id, live: true, playing: true, position: 0, seq: id });
    p.config.events.onStateChange({ data: 1 });
  }
  assert.deepEqual(calls.filter(c => c[0] === 'unload'), [['unload', 'captions'], ['unload', 'captions']]);
  assert.equal(calls.includes('unMute'), false);
});

test('a missing or failing captions module does not interrupt playback setup', () => {
  const { s, p, api, media } = fixture(); api(); s.setMedia(media); s.ready = true;
  p.unloadModule = () => { throw new Error('module unavailable'); };
  assert.doesNotThrow(() => p.config.events.onApiChange());
  p.unloadModule = undefined;
  assert.doesNotThrow(() => p.config.events.onApiChange());
  assert.equal(s.ready, true);
});

test('existing sync tick clears captions even if YouTube changes the track without an API event', () => {
  const { s, calls } = fixture(); s.ready = true;
  s.player = { unloadModule: name => calls.push(['unload', name]) };
  s.apply = () => {}; s.updateSound = () => {};
  s.tick();
  assert.deepEqual(calls, [['unload', 'captions']]);
});
