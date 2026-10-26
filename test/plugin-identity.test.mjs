import test from 'node:test';
import assert from 'node:assert/strict';
import {isSciencePlugin, isPublishedSciencePlugin} from '../src/plugin-identity.js';
test('recognizes exact own package and GitHub source spellings', () => {
  for (const spec of [
    'Jhonny1024/claude-science-local-for-magpie-windows',
    'github:Jhonny1024/claude-science-local-for-magpie-windows#main',
    'git+https://github.com/Jhonny1024/claude-science-local-for-magpie-windows.git',
    'https://github.com/jhonny1024/claude-science-local-for-magpie-windows',
    'claude-science-local-for-magpie',
    'claude-science-local-for-magpie@0.3.0',
    'magpie-science-local',
    'magpie-science-local@0.3.0',
    'nickzhangcomes/claude-science-local-for-magpie',
    'github:nickzhangcomes/claude-science-local-for-magpie#v0.3.0',
    'git+https://github.com/nickzhangcomes/claude-science-local-for-magpie.git#main',
    'https://github.com/nickzhangcomes/claude-science-local-for-magpie',
  ])
    assert.equal(isPublishedSciencePlugin(spec), true, spec);
  for (const spec of [
    'shiyang1026/magpie-claude-science',
    'Guuuu233/claude-science-for-magpie',
    'other/magpie-science-local',
    'https://evil.example/Jhonny1024/claude-science-local-for-magpie-windows',
    'https://github.com/Jhonny1024/claude-science-local-for-magpie-windows.evil',
    'https://evil.example/nickzhangcomes/claude-science-local-for-magpie',
    'https://github.com/nickzhangcomes/claude-science-local-for-magpie.evil',
    '/tmp/magpie-science-local',
    '@other/magpie-science-local',
    null,
  ])
    assert.equal(isSciencePlugin(spec), false, String(spec));
  assert.equal(isSciencePlugin('/private/release', ['/private/release']), true);
});
