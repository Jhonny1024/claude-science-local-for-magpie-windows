import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {desktopLaunchSpec, installDesktopEntries} from '../src/windows-desktop.js';
import {restoreAll} from '../src/files.js';
const run = (bin, args) => {
  const r = spawnSync(bin, args, {encoding: 'utf8', windowsHide: true});
  assert.equal(r.status, 0, r.stderr);
  return r;
};
test('native window handoff uses only the managed daemon and a fresh official local link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'science-desktop-'));
  try {
    const state = {
      data: path.join(root, 'data'),
      binary: path.join(root, 'science.exe'),
      sciencePort: 19080,
      scienceConfig: path.join(root, 'science.toml'),
      statusFile: path.join(root, 'status.json'),
    };
    const shell = path.join(state.data, 'runtime', '0.1.70-release', 'shell');
    const file = path.join(state.data, 'electron', '42.10.0', 'claude-science.exe');
    fs.mkdirSync(shell, {recursive: true});
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(path.join(shell, 'main.js'), 'fixture');
    fs.writeFileSync(file, 'fixture');
    fs.writeFileSync(path.join(root, 'science.com'), 'fixture');
    const lock = {version: '0.1.70', engine: '42.10.0:' + 'a'.repeat(64)};
    fs.writeFileSync(path.join(state.data, 'operon.lock'), JSON.stringify(lock));
    let calls = 0;
    const mint = (bin, args) => {
      calls++;
      assert.equal(bin, path.join(root, 'science.com'));
      assert.deepEqual(args, ['url', '--config', state.scienceConfig, '--data-dir', state.data]);
      return {stdout: 'http://localhost:19080/?nonce=' + String(calls).repeat(64) + '\n'};
    };
    const first = desktopLaunchSpec(state, mint),
      second = desktopLaunchSpec(state, mint);
    assert.equal(first.file, file);
    assert.deepEqual(first.args, [shell]);
    assert.equal(first.env.OPERON_SHELL_ATTACH_DATA_DIR, state.data);
    assert.notEqual(first.env.OPERON_SHELL_ATTACH_URL, second.env.OPERON_SHELL_ATTACH_URL);
    assert.equal(first.env.ELECTRON_DISABLE_SANDBOX, undefined);
    assert.throws(
      () =>
        desktopLaunchSpec(state, () => ({stdout: 'https://example.com/?nonce=' + 'a'.repeat(64)})),
      /managed local/,
    );
    lock.version = '0.1.71';
    fs.writeFileSync(path.join(state.data, 'operon.lock'), JSON.stringify(lock));
    assert.throws(() => desktopLaunchSpec(state, mint), /not verified/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
test(
  'desktop shortcuts route normal clicks through the manager and uninstall restores original bytes',
  {skip: process.platform !== 'win32'},
  () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'science shortcut 中文 '));
    try {
      const root = path.join(home, 'runtime'),
        desktop = path.join(home, 'Desktop'),
        programs = path.join(home, 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs');
      fs.mkdirSync(root);
      fs.mkdirSync(desktop);
      fs.mkdirSync(programs, {recursive: true});
      const binary = path.join(home, 'science.exe');
      fs.writeFileSync(binary, 'fixture');
      const target = path.join(desktop, 'Claude Science.lnk');
      const ps = `$v='${Buffer.from(JSON.stringify({target, binary})).toString('base64')}'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($v)) | ConvertFrom-Json; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p.target); $s.TargetPath=$p.binary; $s.Save()`;
      run('powershell.exe', [
        '-NoProfile',
        '-EncodedCommand',
        Buffer.from(ps, 'utf16le').toString('base64'),
      ]);
      const before = fs.readFileSync(target);
      const journal = path.join(root, 'journal.json');
      const stateFile = path.join(root, 'state.json');
      const state = {node: process.execPath, pluginSpec: home, binary};
      installDesktopEntries({state, stateFile, home, journal, run});
      assert.notDeepEqual(fs.readFileSync(target), before);
      assert.match(
        fs.readFileSync(path.join(root, 'open-science.vbs')).subarray(2).toString('utf16le'),
        /""open""/,
      );
      installDesktopEntries({state, stateFile, home, journal, run});
      assert.deepEqual(restoreAll(journal).conflicts, []);
      assert.deepEqual(fs.readFileSync(target), before);
    } finally {
      fs.rmSync(home, {recursive: true, force: true});
    }
  },
);
