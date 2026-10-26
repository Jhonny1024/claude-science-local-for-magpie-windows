import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {managedWrite} from './files.js';
import {windowsArgument, startupScript} from './windows-service.js';

// Use Science's own attach-only shell, not `open` (which opens a browser)
// or its no-argument launcher (which may start a second, unconfigured daemon).
export function desktopLaunchSpec(state, run) {
  const lock = JSON.parse(fs.readFileSync(path.join(state.data, 'operon.lock'), 'utf8'));
  if (lock.version !== '0.1.70' || !/^\d+\.\d+\.\d+:[a-f0-9]{64}$/.test(lock.engine || ''))
    throw Error('Science desktop handoff is not verified for this version');
  const consoleBinary = state.binary.replace(/\.exe$/i, '.com');
  if (!fs.existsSync(consoleBinary)) throw Error('Science console companion is missing');
  const result = run(consoleBinary, [
    'url',
    '--config',
    state.scienceConfig,
    '--data-dir',
    state.data,
  ]);
  const raw = result.stdout.trim().split(/\r?\n/).at(-1);
  const url = new URL(raw);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    +url.port !== state.sciencePort ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams].length !== 1 ||
    !/^[a-f0-9]{16,128}$/i.test(url.searchParams.get('nonce') || '')
  )
    throw Error('Science did not return a managed local sign-in link');
  const file = path.join(state.data, 'electron', lock.engine.split(':')[0], 'claude-science.exe');
  const shell = path.join(state.data, 'runtime', lock.version + '-release', 'shell');
  if (!fs.existsSync(file) || !fs.existsSync(path.join(shell, 'main.js')))
    throw Error(
      'Science app window engine is missing; open the original app once to finish its dependencies',
    );
  const temporary = path.join(path.dirname(state.statusFile), 'tmp');
  fs.mkdirSync(temporary, {recursive: true});
  const env = {
    ...process.env,
    TEMP: temporary,
    TMP: temporary,
    OPERON_SHELL_ATTACH: '1',
    OPERON_SHELL_ATTACH_DATA_DIR: state.data,
    OPERON_SHELL_ATTACH_EXE: state.binary,
    OPERON_SHELL_ATTACH_URL: raw,
    OPERON_SHELL_ENGINE: lock.engine,
  };
  // Never inherit test/debug flags or disable Electron's sandbox.
  for (const key of [
    'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_EXTRA_LAUNCH_ARGS',
    'ELECTRON_DISABLE_SANDBOX',
    'CLAUDE_CDP_AUTH',
    'CLAUDE_USER_DATA_DIR',
    'OPERON_SHELL_CDP_PORT',
  ])
    delete env[key];
  return {file, args: [shell], env};
}
export async function openWindowsDesktop(state, run) {
  const spec = desktopLaunchSpec(state, run);
  // This is the user-requested visible app, not a hidden background helper.
  const child = spawn(spec.file, spec.args, {
    env: spec.env,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  child.unref();
}

export function installDesktopEntries({state, stateFile, home, journal, run}) {
  const root = path.dirname(stateFile),
    script = path.join(root, 'open-science.vbs');
  managedWrite(script, startupScript(state, stateFile, 'open'), journal);
  const programs = path.join(
    home,
    'AppData',
    'Roaming',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  const targets = [
    path.join(home, 'Desktop', 'Claude Science.lnk'),
    path.join(programs, 'Claude Science.lnk'),
  ];
  const temp = path.join(root, 'desktop-entry.lnk');
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    const input = Buffer.from(
      JSON.stringify({
        target,
        temp,
        binary: state.binary,
        script,
        wscript: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe'),
        args: '//B //Nologo ' + windowsArgument(script),
      }),
    ).toString('base64');
    const ps = `$ErrorActionPreference='Stop'; $v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json; $w=New-Object -ComObject WScript.Shell; $old=$w.CreateShortcut($v.target); if (($old.TargetPath -ieq $v.binary -and !$old.Arguments) -or ($old.TargetPath -ieq $v.wscript -and $old.Arguments -eq $v.args)) { $s=$w.CreateShortcut($v.temp); $s.TargetPath=$v.wscript; $s.Arguments=$v.args; $s.IconLocation=$v.binary+',0'; $s.Description='Claude Science via Magpie'; $s.WindowStyle=1; $s.Save(); 'ready' }`;
    const result = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(ps, 'utf16le').toString('base64'),
    ]);
    if (result.stdout.trim() !== 'ready') continue; // Preserve custom shortcuts.
    try {
      managedWrite(target, fs.readFileSync(temp), journal);
    } finally {
      fs.unlinkSync(temp);
    }
  }
}
