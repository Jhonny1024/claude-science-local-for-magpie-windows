import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runRuntime} from '../src/runtime.js';
import {makeTicket} from '../src/ticket.js';
import {scienceConfig} from '../src/setup.js';
import os from 'node:os';
import {discoverBinary, reservePorts} from '../src/config.js';
assert.equal(process.platform, 'win32', 'This optional check needs Windows Science');
fs.mkdirSync(path.resolve('work'), {recursive: true});
const root = fs.mkdtempSync(path.resolve('work/native-windows-')),
  auth = path.join(root, 'auth'),
  data = path.join(root, 'data');
const ports = await reservePorts({}, {sciencePort: 0, sandboxPort: 0, bridgePort: 0});
const gateway = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/hello') res.end('{"name":"magpie"}');
  else {
    res.statusCode = 404;
    res.end('{}');
  }
});
await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
const token = 'native-integration-local-token';
const ticket = makeTicket(undefined, token);
fs.mkdirSync(path.join(auth, '.oauth-tokens'), {recursive: true});
fs.writeFileSync(
  path.join(auth, 'encryption.key'),
  Object.entries(ticket.keys)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n'),
);
fs.writeFileSync(path.join(auth, '.oauth-tokens', ticket.account + '.enc'), ticket.encrypted);
const state = {
  project: process.cwd(),
  pluginSpec: process.cwd(),
  installed: true,
  binary: discoverBinary('science', {home: os.homedir()}),
  data,
  auth,
  token,
  model: 'fake/first',
  agentConfig: path.join(root, 'agent.json'),
  pluginsFile: path.join(root, 'plugins.json'),
  originalConfig: path.join(root, 'original.toml'),
  scienceConfig: path.join(root, 'science.toml'),
  configJournal: path.join(root, 'journal.json'),
  statusFile: path.join(root, 'status.json'),
  scienceLog: path.join(root, 'integration-science.log'),
  ...ports.ports,
};
fs.writeFileSync(state.originalConfig, '# isolated original\n');
fs.writeFileSync(
  state.scienceConfig,
  scienceConfig('', {data, auth, port: state.sciencePort, model: state.model}),
);
fs.writeFileSync(
  state.agentConfig,
  JSON.stringify({
    gateway: 'http://127.0.0.1:' + gateway.address().port,
    key: 'magpie-science-local',
    models: [{id: 'fake/first', name: 'Windows Test Model', context: 200000, output: 16384}],
  }),
);
fs.writeFileSync(state.pluginsFile, JSON.stringify({plugins: [{spec: process.cwd()}]}));
let runtime;
try {
  await ports.release();
  runtime = await runRuntime(state, {pollMs: 500, startTimeoutMs: 60000});
  const deadline = Date.now() + 90000;
  let status;
  while (Date.now() < deadline) {
    try {
      status = JSON.parse(fs.readFileSync(state.statusFile));
      if (status.state === 'running') break;
      if (status.state === 'error') throw Error(status.error);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(status?.state, 'running');
  const result = {scienceVersion: status.scienceVersion, modelFallback: status.modelFallback};
  const urlOutput = spawnSync(
    state.binary,
    ['url', '--data-dir', data, '--config', state.scienceConfig],
    {encoding: 'utf8', windowsHide: true, timeout: 10000},
  );
  const url = (urlOutput.stdout + '\n' + urlOutput.stderr).match(/https?:\/\/[^\s]+/)[0];
  const origin = new URL(url).origin;
  // Science deliberately requires a form POST before redeeming a launch nonce.
  const signed = await fetch(origin + '/api/auth/nonce', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded', origin},
    body: new URLSearchParams({nonce: new URL(url).searchParams.get('nonce'), dest: '/'}),
  });
  assert.equal(signed.status, 200);
  const cookies = signed.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
  assert.ok(cookies, 'official local sign-in cookie');
  const page = await fetch(origin + '/', {headers: {cookie: cookies}});
  const html = await page.text();
  const bootstrap = html.match(
    /__OPERON__=Object\.assign\(\{\},globalThis\.__OPERON__,(\{.*?\})\)<\/script>/s,
  );
  assert.ok(bootstrap, 'official local UI bootstrap');
  const browserToken = JSON.parse(bootstrap[1]).token;

  for (const endpoint of ['/api/auth/status', '/api/models', '/api/me']) {
    const r = await fetch(origin + endpoint, {
      headers: {
        cookie: cookies,
        ...(browserToken ? {authorization: 'Bearer ' + browserToken} : {}),
      },
    });
    const body = await r.json();
    if (endpoint === '/api/auth/status')
      result.auth = {http: r.status, authenticated: body.authenticated, provider: body.provider};
    if (endpoint === '/api/models') {
      result.models = {
        http: r.status,
        count: Object.values(body.models || {}).flat().length,
        authError: body.auth_error,
        fetchError: body.fetch_error,
        default: body.default_model_id,
      };
      assert.ok(
        Object.values(body.models || {})
          .flat()
          .some((m) => m.name === 'Windows Test Model'),
      );
    }
    if (endpoint === '/api/me') result.meHttp = r.status;
  }
  fs.writeFileSync(
    path.resolve('work/native-windows-result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (runtime) await runtime.shutdown();
  gateway.closeAllConnections();
  await new Promise((r) => gateway.close(r));
  assert.equal(fs.readFileSync(state.originalConfig, 'utf8'), '# isolated original\n');
  console.log('isolated native shutdown and config restoration passed; diagnostic files: ' + root);
}
