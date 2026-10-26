import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Missing exports are assertions during the first red run, rather than import errors.
const agentModule = await import('../src/agent.js').catch(() => ({}));
const {SCIENCE_ICON} = await import('../src/icon.js');
test('agent declares the dedicated Science config and installed app', () => {
  const {notice, ...metadata} = agentModule.agent;
  assert.match(notice, /本地接入/);
  assert.deepEqual(metadata, {
    id: 'science-local',
    name: 'Claude Science Local for Magpie',
    config: '~/.config/magpie/science-local.json',
    format: 'json',
    dir: '~/.claude-science',
    icon: SCIENCE_ICON,
  });
});
test('connect returns the whole model catalog with its capabilities and leaves input unchanged', () => {
  const input = {
    gateway: {url: 'http://127.0.0.1:3425', key: 'local-agent-key'},
    models: [
      {
        id: 'codex/gpt-6-astra',
        name: 'GPT-6-Astra',
        context: 272000,
        output: 128000,
        images: true,
        efforts: ['high'],
      },
      {
        id: 'deepseek/deepseek-flash',
        name: 'DeepSeek-V4.1-Flash',
        context: 1048576,
        output: 393216,
        images: false,
        efforts: [],
      },
    ],
  };
  const original = structuredClone(input);
  assert.deepEqual(agentModule.connect(input), {
    gateway: input.gateway.url,
    key: input.gateway.key,
    models: input.models,
  });
  assert.deepEqual(input, original);
  assert.equal(
    Object.hasOwn(agentModule.agent, 'model'),
    false,
    'Magpie requires no model key for list mode',
  );
});
test('connect handles empty catalogs and missing metadata without retaining an old model', () => {
  const gateway = {url: 'http://localhost', key: 'key'};
  assert.deepEqual(agentModule.connect({gateway}).models, []);
  assert.deepEqual(agentModule.connect({gateway, models: []}).models, []);
  assert.deepEqual(agentModule.connect({gateway, models: [{id: 'codex/gpt-6-astra'}]}).models, [
    {
      id: 'codex/gpt-6-astra',
      name: 'codex/gpt-6-astra',
      context: 0,
      output: 0,
      images: false,
      efforts: [],
    },
  ]);
});
test('Science icon is an offline 128px PNG shared by agent and plugin metadata', () => {
  assert.equal(typeof SCIENCE_ICON, 'string', 'SCIENCE_ICON must be exported');
  assert.match(SCIENCE_ICON, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  const png = Buffer.from(SCIENCE_ICON.split(',')[1], 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
  assert.ok(Buffer.byteLength(SCIENCE_ICON) < 50000, 'Embedded icon should stay modest');
  assert.equal(agentModule.agent.icon, SCIENCE_ICON);
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.magpie.icon, SCIENCE_ICON);
});

test('Windows agent declaration uses only plugin-local imports and static expanded paths', async () => {
  const {agent, connect} = await import('../src/agent-windows.js');
  assert.equal(agent.dir, '~/AppData/Local/Programs/ClaudeScience');
  assert.equal(agent.bin, 'claude-science');
  assert.equal(agent.id, 'science-local');
  assert.equal(typeof connect, 'function');
  for (const file of ['src/agent.js', 'src/agent-windows.js'])
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /(?:from|import)\s*['"]node:|process\.platform|os\.homedir/,
    );
});
