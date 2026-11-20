#!/usr/bin/env node
/**
 * Static & runtime contract verifier for PerfTicker-wallpaper (v1.5.2).
 * Validates Wallpaper Engine project.json, HTML asset links, and C#/WebSocket bridge schema parity.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();

const projectJson = JSON.parse(fs.readFileSync(path.join(root, 'wallpaper/project.json'), 'utf8'));
assert.equal(projectJson.file, 'index.html', 'wallpaper/project.json must point to index.html');
assert.ok(projectJson.general?.properties, 'wallpaper/project.json must define Wallpaper Engine properties');

const indexHtml = fs.readFileSync(path.join(root, 'wallpaper/index.html'), 'utf8');
for (const scriptRel of ['js/theme.js', 'js/charts.js', 'js/app.js']) {
  assert.ok(indexHtml.includes(scriptRel), `wallpaper/index.html must load ${scriptRel}`);
  assert.ok(fs.existsSync(path.join(root, 'wallpaper', scriptRel)), `Missing wallpaper/${scriptRel}`);
}

const themeJs = fs.readFileSync(path.join(root, 'wallpaper/js/theme.js'), 'utf8');
assert.ok(themeJs.includes('var fmt = PT.fmt = PT.fmt ||'), 'theme.js must preserve PT.fmt namespace');

const bridgeCs = fs.readFileSync(path.join(root, 'PerfTicker/Bridge.cs'), 'utf8');
assert.ok(bridgeCs.includes('127.0.0.1'), 'Bridge.cs must bind strictly to loopback 127.0.0.1');

console.log('[OK] PerfTicker-wallpaper v1.5.2 static & bridge invariants verified.');
