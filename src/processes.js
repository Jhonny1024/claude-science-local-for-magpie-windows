import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// PID alone is not ownership: include the kernel's start time and full argv.
export function readProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if ($p) { if (!$p.CommandLine) { throw 'Process command line unavailable' }; [pscustomobject]@{created=$p.CreationDate.ToUniversalTime().Ticks.ToString();command=$p.CommandLine} | ConvertTo-Json -Compress }`,
      ],
      {encoding: 'utf8', timeout: 10000, windowsHide: true},
    );
    if (result.status !== 0 || result.error)
      throw Error(
        'Cannot query Windows process ownership: ' +
          (result.error?.message || result.stderr.trim()),
      );
    const value = result.stdout.trim();
    if (!value) return null;
    const record = JSON.parse(value);
    if (!record.created || !record.command) throw Error('Incomplete Windows process identity');
    return JSON.stringify(record);
  }
  const result = spawnSync(
    '/bin/ps',
    ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'command='],
    {encoding: 'utf8', timeout: 2000},
  );
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}
// Parse CommandLineToArgvW-style quoting without invoking a shell.
export function windowsArguments(command) {
  const result = [];
  let word = '',
    quoted = false,
    started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\') {
      let count = 1;
      while (command[i + 1] === '\\') {
        count++;
        i++;
      }
      if (command[i + 1] === '"') {
        word += '\\'.repeat(Math.floor(count / 2));
        i++;
        if (count % 2) word += '"';
        else quoted = !quoted;
      } else word += '\\'.repeat(count);
      started = true;
    } else if (c === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(c) && !quoted) {
      if (started) {
        result.push(word);
        word = '';
        started = false;
      }
    } else {
      word += c;
      started = true;
    }
  }
  if (started) result.push(word);
  return result;
}
function identityArguments(identity) {
  try {
    const parsed = JSON.parse(identity);
    if (parsed.created && parsed.command) return windowsArguments(parsed.command);
  } catch {}
  return null;
}
export function processHasArguments(identity, values) {
  if (typeof identity !== 'string') return false;
  const args = identityArguments(identity);
  return args
    ? values.every((value) => args.includes(value))
    : values.every((value) => identity.includes(value));
}
function argument(identity, flag, value) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) return false;
  const args = identityArguments(identity);
  if (args) return args.some((arg, i) => arg === flag && args[i + 1] === value);
  return (identity + ' ').includes(` ${flag} ${value} `);
}
export function ownsDaemon(lease, state) {
  return Boolean(
    lease &&
    lease.data === state.data &&
    lease.config === state.scienceConfig &&
    typeof lease.identity === 'string' &&
    lease.identity === readProcessIdentity(lease.pid) &&
    argument(lease.identity, '--data-dir', state.data) &&
    argument(lease.identity, '--config', state.scienceConfig),
  );
}
export function signalOwnedDaemon(lease, state, signal = 'SIGTERM') {
  if (!['SIGTERM', 'SIGKILL'].includes(signal)) throw Error('Unsupported daemon signal');
  if (!ownsDaemon(lease, state)) return false;
  try {
    process.kill(lease.pid, signal);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
}

export function acquireRuntimeOwner(file, owner) {
  // A separate short-lived exclusive lock serializes stale-record recovery.
  // An interrupted recovery is left for explicit inspection, never guessed away.
  let fd;
  try {
    fd = fs.openSync(file + '.recovery', 'wx', 0o600);
  } catch (e) {
    if (e.code === 'EEXIST')
      throw Error('Another startup or interrupted recovery owns ' + file + '.recovery');
    throw e;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(owner));
    let current;
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw Error('Refusing symlink owner record');
      current = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (current && current.identity === readProcessIdentity(current.pid))
      throw Error('Another Science integration service owns this profile');
    if (current) fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify(owner), {flag: 'wx', mode: 0o600});
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(file + '.recovery');
  }
}

// A manual desktop launch can occupy the managed profile without the bridge
// environment. Do not adopt it or kill it based only on a PID.
export function assertProfileAvailable(state) {
  const file = path.join(state.data, 'operon.lock');
  let lock;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('Refusing symlink Science lock');
    lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  if (Number.isSafeInteger(lock.pid) && lock.pid > 1 && readProcessIdentity(lock.pid))
    throw Error(
      'Science is already running for the managed data directory outside this service. Close that Science instance, then retry upgrade; use the integration open command afterwards.',
    );
}
