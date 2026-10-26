import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {windowsArguments, readProcessIdentity} from '../src/processes.js';
import {
  windowsArgument,
  startupScript,
  secureDirectory,
  ownsManager,
  startupPath,
  requestShutdown,
} from '../src/windows-service.js';
import {managedWrite, restoreAll} from '../src/files.js';
import {discoverBinary} from '../src/config.js';
import {createInstaller} from '../src/cli.js';
const win = process.platform === 'win32';
const project = path.resolve('.');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(150);
  }
  throw Error('Windows lifecycle timeout');
}
const run = (bin, args) => {
  const r = spawnSync(bin, args, {encoding: 'utf8', windowsHide: true, timeout: 20000});
  if (r.status !== 0 || r.error) throw Error(r.error?.message || r.stderr || 'Command failed');
  return r;
};

test('Windows quoting round-trips spaces, Unicode, quotes and trailing backslashes', () => {
  const values = [
    'D:\\Project\\with space\\node.exe',
    'D:\\项目\\配置.json',
    'a"b',
    'D:\\trailing\\',
    '',
    'a\\"b',
  ];
  assert.deepEqual(windowsArguments(values.map(windowsArgument).join(' ')), values);
  assert.throws(() => windowsArgument('bad\narg'), /Invalid/);
});

test(
  'Windows binary discovery resolves exe names and per-user Science installation',
  {skip: !win},
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'science-discovery-'));
    try {
      const bin = path.join(root, 'magpie-windows-amd64.exe');
      fs.writeFileSync(bin, 'fixture');
      assert.equal(discoverBinary('magpie', {home: root, env: {PATH: root}}), bin);
      const science = path.join(root, 'AppData/Local/Programs/ClaudeScience/claude-science.exe');
      fs.mkdirSync(path.dirname(science), {recursive: true});
      fs.writeFileSync(science, 'fixture');
      assert.equal(discoverBinary('science', {home: root, env: {PATH: ''}}), science);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'Windows private runtime uses a protected current-user ACL and rejects junctions',
  {skip: !win},
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'science-acl-'));
    try {
      secureDirectory(root, run);
      const script =
        '$ErrorActionPreference="Stop"; $a=[System.IO.Directory]::GetAccessControl($env:SCIENCE_ACL_TEST); $a | Select-Object AreAccessRulesProtected,@{n="Rules";e={@($_.Access | ForEach-Object {[pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;inherited=$_.IsInherited;rights=$_.FileSystemRights.ToString()}})}} | ConvertTo-Json -Depth 4 -Compress';
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        encoding: 'utf8',
        env: {...process.env, SCIENCE_ACL_TEST: root},
      });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout, 'ACL query empty: ' + r.stderr);
      const acl = JSON.parse(r.stdout);
      assert.equal(acl.AreAccessRulesProtected, true);
      const rules = Array.isArray(acl.Rules) ? acl.Rules : [acl.Rules];
      assert.equal(rules.length, 1);
      assert.equal(rules[0].inherited, false);
      assert.match(rules[0].rights, /FullControl/);
      const outside = path.join(root, 'outside'),
        link = path.join(root, 'junction');
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, link, 'junction');
      assert.throws(
        () => managedWrite(path.join(link, 'secret'), 'x', path.join(root, 'journal.json')),
        /symlink/,
      );
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'Windows startup script launches the owned Node with spaced paths and no visible window',
  {skip: !win},
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'science startup 中文 '));
    try {
      const release = path.join(root, 'release'),
        marker = path.join(root, 'state file.json');
      fs.mkdirSync(path.join(release, 'src'), {recursive: true});
      fs.writeFileSync(path.join(release, 'package.json'), '{"type":"commonjs"}');
      fs.writeFileSync(
        path.join(release, 'src/windows-launcher.js'),
        `require('node:fs').writeFileSync(process.argv[2], 'started');`,
      );
      const script = path.join(root, 'start.vbs');
      fs.writeFileSync(
        script,
        startupScript({node: process.execPath, pluginSpec: release}, marker),
      );
      run('cscript.exe', ['//B', '//Nologo', script]);
      await until(() => fs.existsSync(marker), 10000);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'started');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'Windows installer performs install, upgrade, failed upgrade recovery, rollback, restart and uninstall',
  {skip: !win, timeout: 240000},
  async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'science windows integration '));
    const configRoot = path.join(home, '.config/magpie'),
      runtimeRoot = path.join(home, 'runtime'),
      source = path.join(home, 'source');
    fs.mkdirSync(configRoot, {recursive: true});
    fs.mkdirSync(source);
    fs.cpSync(path.join(project, 'src'), path.join(source, 'src'), {recursive: true});
    fs.copyFileSync(path.join(project, 'package.json'), path.join(source, 'package.json'));
    const scienceScript = path.join(home, 'fake-science.cjs');
    fs.writeFileSync(
      scienceScript,
      `const fs=require('node:fs'),path=require('node:path'),http=require('node:http');const arg=n=>process.argv[process.argv.indexOf(n)+1],data=arg('--data-dir'),port=+arg('--port');fs.mkdirSync(data,{recursive:true});http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end('{"status":"healthy"}')}).listen(port,'127.0.0.1',()=>fs.writeFileSync(path.join(data,'operon.lock'),JSON.stringify({pid:process.pid,port,sandbox_port:+arg('--sandbox-port'),version:'fixture'})));`,
    );
    const gateway = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/hello') res.end('{"name":"magpie"}');
      else if (req.url === '/v1/models')
        res.end('{"data":[{"id":"fake/first"},{"id":"fake/second"}]}');
      else
        res.end(
          '{"type":"message","model":"fake/first","content":[{"type":"text","text":"fixture response"}]}',
        );
    });
    await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
    const gatewayURL = 'http://127.0.0.1:' + gateway.address().port;
    const magpie = path.join(home, 'magpie.exe');
    fs.writeFileSync(magpie, 'fixture');
    const registryFile = path.join(configRoot, 'plugins.json');
    let fail = false,
      state;
    const invoke = (bin, args) => {
      if (bin === magpie) {
        let registry = fs.existsSync(registryFile)
          ? JSON.parse(fs.readFileSync(registryFile))
          : {plugins: []};
        const [command, action, spec] = args;
        if (command === 'plugin') {
          let entry = registry.plugins.find((e) => e.spec === spec);
          if (action === 'add' && !entry) {
            entry = {spec};
            registry.plugins.push(entry);
          }
          if (action === 'on') entry.off = false;
          if (action === 'off' && entry) entry.off = true;
          if (action === 'rm') registry.plugins = registry.plugins.filter((e) => e.spec !== spec);
          fs.writeFileSync(registryFile, JSON.stringify(registry));
        }
        if (command === 'science-local')
          fs.writeFileSync(
            path.join(configRoot, 'science-local.json'),
            JSON.stringify(
              action === 'default'
                ? {}
                : {
                    gateway: gatewayURL,
                    key: 'magpie-science-local',
                    models: [{id: 'fake/first'}, {id: 'fake/second'}],
                  },
            ),
          );
        return {status: 0, stdout: ''};
      }
      if (bin === process.execPath && args[0] === 'stop') return {status: 0, stdout: ''};
      return run(bin, args);
    };
    const cli = createInstaller({
      home,
      project: source,
      runtimeRoot,
      env: {},
      run: invoke,
      scienceArgs: [scienceScript],
      log: () => {},
      waitHealthy: async (s) => {
        await until(() => {
          try {
            const status = JSON.parse(fs.readFileSync(s.statusFile));
            return (
              status.state === 'running' &&
              status.pluginSpec === s.pluginSpec &&
              ownsManager(s, cli.stateFile, status)
            );
          } catch {
            return false;
          }
        });
        assert.equal((await fetch(`http://127.0.0.1:${s.sciencePort}/health`)).ok, true);
        if (fail) {
          fail = false;
          throw Error('injected upgrade failure');
        }
      },
    });
    const options = {magpie, science: process.execPath, model: 'fake/first', gateway: gatewayURL};
    try {
      const first = (state = await cli.execute({...options, command: 'install'}));
      assert.equal(path.dirname(cli.stateFile), runtimeRoot);
      assert.equal(path.extname(first.node), '.exe');
      assert.ok(fs.existsSync(startupPath(home)));
      fs.writeFileSync(path.join(first.data, 'retained-session'), 'keep');
      const originalAuth = fs.readFileSync(path.join(first.auth, 'encryption.key'));
      const bridge = await fetch(`http://127.0.0.1:${first.bridgePort}/v1/messages`, {
        method: 'POST',
        headers: {authorization: 'Bearer ' + first.token, 'content-type': 'application/json'},
        body: JSON.stringify({model: 'fake/first', messages: []}),
      });
      assert.equal(bridge.status, 200);
      assert.equal((await bridge.json()).content[0].text, 'fixture response');
      // Exercise the real login launcher, including redirected manager logs.
      const firstManager = JSON.parse(fs.readFileSync(first.statusFile));
      requestShutdown(first, firstManager);
      await until(() => readProcessIdentity(firstManager.pid) === null);
      run('cscript.exe', ['//B', '//Nologo', startupPath(home)]);
      await until(() => {
        const status = JSON.parse(fs.readFileSync(first.statusFile));
        return (
          status.pid !== firstManager.pid &&
          status.state === 'running' &&
          ownsManager(first, cli.stateFile, status)
        );
      });
      assert.ok(
        fs
          .readFileSync(path.join(runtimeRoot, 'service.log'), 'utf8')
          .split('Science integration service ready').length >= 3,
      );

      fs.appendFileSync(path.join(source, 'src/runtime.js'), '\n// Windows upgrade fixture\n');
      const second = (state = await cli.execute({...options, command: 'upgrade'}));
      assert.notEqual(first.deployment.id, second.deployment.id);
      const before = fs.readFileSync(cli.stateFile, 'utf8');
      fail = true;
      await assert.rejects(
        cli.execute({...options, command: 'upgrade'}),
        /injected upgrade failure/,
      );
      assert.equal(fs.readFileSync(cli.stateFile, 'utf8'), before);
      state = await cli.execute({...options, command: 'rollback'});
      assert.equal(state.deployment.id, first.deployment.id);
      await cli.execute({command: 'restart'});
      const running = JSON.parse(fs.readFileSync(state.statusFile));
      assert.equal(ownsManager(state, cli.stateFile, running), true);
      process.kill(running.pid, 'SIGKILL');
      await until(() => readProcessIdentity(running.pid) === null);
      assert.ok(readProcessIdentity(running.sciencePid));
      await cli.execute({command: 'uninstall'});
      assert.equal(readProcessIdentity(running.sciencePid), null);
      assert.equal(fs.existsSync(startupPath(home)), false);
      assert.equal(fs.existsSync(state.originalConfig), false);
      assert.equal(fs.readFileSync(path.join(first.data, 'retained-session'), 'utf8'), 'keep');
      assert.deepEqual(fs.readFileSync(path.join(first.auth, 'encryption.key')), originalAuth);
      assert.equal(readProcessIdentity(running.pid), null);
    } finally {
      if (state) {
        try {
          await cli.execute({command: 'uninstall'});
        } catch {}
      }
      gateway.closeAllConnections();
      await new Promise((r) => gateway.close(r));
      fs.rmSync(home, {recursive: true, force: true});
    }
  },
);
