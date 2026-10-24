import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createBridge} from '../src/bridge.js';
import {modelAlias} from '../src/models.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.MAGPIE_BIN || '/Applications/magpie.app/Contents/MacOS/magpie';
fs.accessSync(binary, fs.constants.X_OK);
const bun =
  process.env.MAGPIE_BUN ||
  (process.env.PATH || '')
    .split(path.delimiter)
    .map((dir) => path.join(dir, 'bun'))
    .find((file) => {
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
// Hooks execute in Magpie, but the CLI's plugin inventory still initializes Bun.
assert.ok(bun, 'Set MAGPIE_BUN to the existing Magpie Bun binary for isolated tests.');
const portProbe = http.createServer();
await listen(portProbe, 0);
const address = '127.0.0.1:' + portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const base = 'http://' + address;
fs.mkdirSync(path.join(root, 'work'), {recursive: true});
const lab = fs.mkdtempSync(
  path.join(fs.realpathSync(path.join(root, 'work')), 'magpie-integration-'),
);
const home = path.join(lab, 'home');
fs.mkdirSync(home);
const env = {
  PATH: process.env.PATH,
  HOME: home,
  USER: 'magpie-test',
  LOGNAME: 'magpie-test',
  TMPDIR: lab,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  XDG_DATA_HOME: path.join(home, '.local', 'share'),
  MAGPIE_ADDR: address,
  ...(bun ? {MAGPIE_BUN: bun} : {}),
  MAGPIE_NO_STATS: '1',
  DO_NOT_TRACK: '1',
  MAGPIE_NO_ACCOUNTS: '1',
  MAGPIE_NO_SHORTCUT: '1',
  // Prevent unrelated background catalogue/download HTTP traffic from leaving the machine.
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
  ALL_PROXY: 'http://127.0.0.1:1',
  NO_PROXY: '127.0.0.1,localhost,::1',
};
const children = new Set();
let server,
  bridge,
  gateway,
  logs = '';
const calls = [];
async function cli(args) {
  const child = spawn(binary, args, {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
  children.add(child);
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, `magpie ${args[0]} failed: ${output}`);
    return output;
  } finally {
    clearTimeout(timer);
    children.delete(child);
  }
}
async function listen(server, port) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
async function request(body, agent = 'science-local', throughBridge = false) {
  const response = await fetch(
    (throughBridge ? `http://127.0.0.1:${bridge.address().port}` : base) + '/v1/messages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: throughBridge ? 'Bearer test-bridge-token' : 'Bearer magpie-' + agent,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return body.stream ? text : JSON.parse(text);
}
try {
  server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({data: [{id: 'luna', type: 'model', display_name: 'Local Fake Luna'}]}),
      );
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    calls.push({path: req.url, body});
    if (req.url === '/v1/messages/count_tokens') {
      res.setHeader('content-type', 'application/json');
      res.end('{"input_tokens":7}');
      return;
    }
    if (req.url !== '/v1/messages') {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    const message = {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: 'luna',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {input_tokens: 7, output_tokens: 0},
    };
    if (!body.stream) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          ...message,
          content: [{type: 'tool_use', id: 'tool_fake', name: 'echo', input: {value: 'hello'}}],
          stop_reason: 'tool_use',
          usage: {input_tokens: 7, output_tokens: 4},
        }),
      );
      return;
    }
    res.setHeader('content-type', 'text/event-stream');
    const events = [
      {type: 'message_start', message},
      {
        type: 'content_block_start',
        index: 0,
        content_block: {type: 'tool_use', id: 'tool_fake', name: 'echo', input: {}},
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: {type: 'input_json_delta', partial_json: '{"value":"hello"}'},
      },
      {type: 'content_block_stop', index: 0},
      {
        type: 'message_delta',
        delta: {stop_reason: 'tool_use', stop_sequence: null},
        usage: {output_tokens: 4},
      },
      {type: 'message_stop'},
    ];
    for (const event of events)
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await listen(server, 0);
  const upstream = 'http://127.0.0.1:' + server.address().port;
  // Exercise Magpie's real migration of previously stashed single-model keys.
  const legacy = path.join(lab, 'legacy');
  fs.mkdirSync(legacy);
  fs.writeFileSync(
    path.join(legacy, 'package.json'),
    JSON.stringify({name: 'magpie-science-local', version: '0.1.0', magpie: {agent: './agent.js'}}),
  );
  fs.writeFileSync(
    path.join(legacy, 'agent.js'),
    `export const agent={id:'science-local',name:'Science legacy fixture',config:'~/.config/magpie/science-local.json',format:'json',model:'model'};export function connect({gateway,model}){return {gateway:gateway.url,key:gateway.key,displayName:model.name||model.id};}`,
  );
  await cli(['provider', 'add', 'fake', 'anthropic=' + upstream, 'key=test', 'models=luna,astra']);
  await cli(['plugin', 'add', legacy]);
  await cli(['science-local', 'fake/luna']);
  const prior = JSON.parse(fs.readFileSync(path.join(home, '.config/magpie/science-local.json')));
  assert.equal(prior.model, 'fake/luna');
  assert.ok(prior.displayName);
  await cli(['plugin', 'off', legacy]);
  await cli(['plugin', 'add', root]);
  const agents = await cli(['agents']);
  assert.match(agents, /science-local/);
  const plugins = await cli(['plugin', 'list', '--json']);
  assert.match(plugins, /science-local/);
  assert.doesNotMatch(plugins, /magpie's own agent/);
  await cli(['science-local', 'magpie']);
  const agentConfig = JSON.parse(
    fs.readFileSync(path.join(home, '.config', 'magpie', 'science-local.json'), 'utf8'),
  );
  assert.equal(agentConfig.model, undefined);
  assert.equal(agentConfig.displayName, undefined);
  assert.deepEqual(agentConfig.models.map((m) => m.id).sort(), ['fake/astra', 'fake/luna']);
  assert.equal(agentConfig.gateway, base);
  assert.equal(agentConfig.key, 'magpie-science-local');
  gateway = spawn(binary, ['serve'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
  children.add(gateway);
  gateway.stdout.on('data', (data) => {
    logs += data;
  });
  gateway.stderr.on('data', (data) => {
    logs += data;
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(gateway.exitCode, null, 'Gateway exited: ' + logs);
    try {
      const response = await fetch(base + '/v1/models', {signal: AbortSignal.timeout(500)});
      if (response.ok) {
        const catalog = await response.json();
        assert.ok(catalog.data.some((model) => model.id === 'fake/luna'));
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Isolated gateway did not start: ' + logs);
  bridge = createBridge(() => ({...agentConfig, token: 'test-bridge-token'}));
  await listen(bridge, 0);
  const body = {
    model: modelAlias('fake/luna'),
    max_tokens: 64,
    stream: true,
    messages: [{role: 'user', content: 'Call echo with hello.'}],
    tools: [
      {
        name: 'echo',
        description: 'Echo a value',
        input_schema: {type: 'object', properties: {value: {type: 'string'}}, required: ['value']},
      },
    ],
  };
  const stream = await request(body, 'science-local', true);
  const events = stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  assert.equal(events.find((event) => event.type === 'message_start').message.model, body.model);
  assert.deepEqual(events.find((event) => event.type === 'content_block_delta').delta, {
    type: 'input_json_delta',
    partial_json: '{"value":"hello"}',
  });
  assert.ok(events.some((event) => event.type === 'message_stop'));
  assert.equal(calls.at(-1).body.model, 'luna');
  assert.deepEqual(calls.at(-1).body.tools, body.tools);
  const reply = await request({...body, stream: false}, 'science-local', true);
  assert.equal(reply.model, body.model);
  assert.equal(reply.content[0].type, 'tool_use');
  const other = await request({...body, model: 'fake/luna', stream: false}, 'other-agent');
  assert.equal(calls.at(-1).body.model, 'luna');
  assert.equal(other.model, 'luna');
  const counted = await fetch(base + '/v1/messages/count_tokens', {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: 'Bearer magpie-science-local'},
    body: JSON.stringify({model: 'fake/luna', messages: body.messages, tools: body.tools}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(counted.status, 200);
  assert.deepEqual(await counted.json(), {input_tokens: 7});
  assert.equal(calls.at(-1).path, '/v1/messages/count_tokens');
  assert.equal(calls.at(-1).body.model, 'luna');
  const unknownAlias = await fetch(base + '/v1/messages', {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: 'Bearer magpie-other-agent'},
    body: JSON.stringify({...body, stream: false}),
  });
  assert.notEqual(unknownAlias.status, 200, 'Other agent alias must not be rewritten');
  await unknownAlias.text();
  // Model translation belongs entirely to the local bridge; Magpie receives real IDs.
  const direct = await request({...body, model: 'fake/luna', stream: false});
  assert.equal(calls.at(-1).body.model, 'luna');
  assert.equal(direct.content[0].type, 'tool_use');
  const directStream = await request({...body, model: 'fake/luna'});
  assert.match(directStream, /message_stop/);
  for (const chosen of ['fake/luna', 'fake/astra']) {
    const response = await fetch(`http://127.0.0.1:${bridge.address().port}/v1/messages`, {
      method: 'POST',
      headers: {authorization: 'Bearer test-bridge-token', 'content-type': 'application/json'},
      body: JSON.stringify({...body, model: modelAlias(chosen), stream: false}),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, modelAlias(chosen));
    assert.equal(calls.at(-1).body.model, chosen.split('/')[1]);
  }
  assert.doesNotMatch(logs, /middleware.*(didn't load|failed|onRequest.*error)/i);
  console.log(
    'PASS: legacy single-model migration; full model catalog; distinct per-model routing; agent-only registration; local bridge translation; streaming tool deltas; nonstreaming alias echo; token counting; other-agent isolation.',
  );
} finally {
  await Promise.all([...children].map(stop));
  if (bridge) {
    bridge.closeAllConnections();
    await new Promise((resolve) => bridge.close(resolve));
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  fs.rmSync(lab, {recursive: true, force: true});
}
