import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {
  readProcessIdentity,
  processHasArguments,
  ownsDaemon,
  signalOwnedDaemon,
} from './processes.js';

// Standard Windows command-line quoting, including trailing backslashes.
export function windowsArgument(value) {
  const s = String(value);
  if (/[\r\n\0]/.test(s)) throw Error('Invalid Windows argument');
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
export function startupScript(state, stateFile) {
  const command = [
    state.node,
    path.join(state.pluginSpec || state.project, 'src', 'windows-launcher.js'),
    stateFile,
  ]
    .map(windowsArgument)
    .join(' ');
  const script =
    'Option Explicit\r\nCreateObject("WScript.Shell").Run "' +
    command.replaceAll('"', '""') +
    '", 0, False\r\n';
  // WSH reads UTF-16LE with a BOM; plain UTF-8 corrupts non-ASCII paths.
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')]);
}
export function startupPath(home) {
  return path.join(
    home,
    'AppData',
    'Roaming',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'magpie-science-local.vbs',
  );
}
export function secureDirectory(root, run) {
  const sid = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ]).stdout.trim();
  if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) throw Error('Cannot establish Windows user SID');
  // A private ACL replaces POSIX modes for generated credentials and logs.
  run('icacls.exe', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]);
}
export function ownsManager(state, stateFile, status) {
  if (!status?.pid || !status.identity) return false;
  const identity = readProcessIdentity(status.pid);
  return (
    identity === status.identity &&
    processHasArguments(identity, [
      path.join(state.pluginSpec || state.project, 'src', 'runtime.js'),
      stateFile,
    ])
  );
}
export function launchWindows(state, stateFile, log) {
  const temporary = path.join(path.dirname(state.statusFile), 'tmp');
  fs.mkdirSync(temporary, {recursive: true, mode: 0o700});
  const fd = fs.openSync(log, 'a', 0o600);
  try {
    const child = spawn(
      state.node,
      [path.join(state.pluginSpec || state.project, 'src', 'runtime.js'), stateFile],
      {
        env: {...process.env, TEMP: temporary, TMP: temporary},
        detached: true,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      },
    );
    // spawn() reports missing executables asynchronously; do not report success early.
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    fs.closeSync(fd);
  }
}
export function requestShutdown(state, status) {
  const file = path.join(path.dirname(state.statusFile), 'stop-request.json');
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error('Refusing symlink stop request');
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({pid: status.pid, identity: status.identity}), {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// A crashed manager can leave a healthy detached Science process behind.
// Uninstall must reap that owned lease too, without touching other profiles.
export async function stopWindowsOrphan(state, run) {
  const file = path.join(path.dirname(state.statusFile), 'daemon-lease.json');
  if (!fs.existsSync(file)) return;
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('Refusing symlink daemon lease');
  const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!ownsDaemon(lease, state)) return;
  if (state.binaryArgs) signalOwnedDaemon(lease, state);
  else run(state.binary, ['stop', '--data-dir', state.data, '--config', state.scienceConfig]);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && ownsDaemon(lease, state))
    await new Promise((r) => setTimeout(r, 100));
  if (ownsDaemon(lease, state)) signalOwnedDaemon(lease, state, 'SIGKILL');
  if (ownsDaemon(lease, state)) throw Error('Owned Science orphan did not stop; files retained');
  fs.unlinkSync(file);
}
