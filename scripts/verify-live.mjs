// Explicit opt-in smoke test: one real Science conversation, billed by the
// user's selected Magpie provider. Never prints a login URL, cookie or key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {modelAlias} from '../src/models.js';
const root = path.join(os.homedir(), '.config/magpie/science-local-runtime');
const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json')));
const status = JSON.parse(fs.readFileSync(state.statusFile));
assert.equal(status.state, 'running', 'The local adapter must be running first.');
const r = spawnSync(
  state.binary,
  ['url', '--config', state.scienceConfig, '--data-dir', state.data],
  {encoding: 'utf8', timeout: 10000},
);
assert.equal(r.status, 0, 'Cannot obtain a local Science login link.');
const match = r.stdout.match(/http:\/\/(?:127\.0\.0\.1|localhost):[^\s\x1b]+/);
assert.ok(match, 'No local Science login link.');
const url = new URL(match[0]);
assert.equal(Number(url.port), state.sciencePort, 'Login link belongs to a different daemon.');
const login = await fetch(url.origin + '/api/auth/nonce', {
  method: 'POST',
  headers: {'content-type': 'application/x-www-form-urlencoded', origin: url.origin},
  body: new URLSearchParams({nonce: url.searchParams.get('nonce') || '', dest: '/'}),
  redirect: 'manual',
  signal: AbortSignal.timeout(60000),
});
const cookie = login.headers.getSetCookie().find((x) => x.startsWith('operon_auth='));
assert.ok(cookie, 'Local Science browser login failed.');
const bearer = cookie.split(';')[0].slice('operon_auth='.length);
async function api(endpoint, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url.origin + endpoint, {
        method: body ? 'POST' : 'GET',
        headers: {authorization: `Bearer ${bearer}`, 'content-type': 'application/json'},
        ...(body ? {body: JSON.stringify(body)} : {}),
        signal: AbortSignal.timeout(20000),
      });
      assert.ok(res.ok, `${endpoint} returned ${res.status}`);
      return await res.json();
    } catch (error) {
      if (body || attempt >= 2 || error.name !== 'TimeoutError') throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
const auth = await api('/api/auth/status');
assert.equal(auth.authenticated, true);
const models = await api('/api/models');
assert.ok(models.models?.anthropic?.length);
const selection = JSON.parse(fs.readFileSync(state.agentConfig));
const requestedIndex = process.argv.indexOf('--model');
const target =
  requestedIndex < 0 ? selection.model || state.model : process.argv[requestedIndex + 1];
const alias =
  state.deployment && models.models.anthropic.some((m) => m.id === modelAlias(target))
    ? modelAlias(target)
    : 'claude-sonnet-4-6';
const health = await api('/api/status');
const report = {
  checkedAt: new Date().toISOString(),
  scienceVersion: status.scienceVersion,
  agentId: 'science-local',
  model: target,
  localLogin: true,
  modelCount: models.models.anthropic.length,
  models: models.models.anthropic.map((m) => ({id: m.id, name: m.name})),
  defaultModel: models.default_model_id,
  runningJobs: health.running_jobs,
};
if (process.argv.includes('--chat') || process.argv.includes('--resume-latest')) {
  assert.equal(health.running_jobs, 0, 'Wait for existing Science jobs before live verification.');
  let submitted;
  if (process.argv.includes('--resume-latest')) {
    const projectResult = await api('/api/projects?limit=100');
    const projects = Array.isArray(projectResult) ? projectResult : projectResult.projects;
    assert.ok(
      Array.isArray(projects),
      'Expected project list; fields: ' + Object.keys(projectResult),
    );
    const project = projects
      .filter((p) => p.name === '本地接入验证')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    assert.ok(project, 'No verification project to resume');
    const frameResult = await api(
      '/api/frames?root_only=true&project_id=' + encodeURIComponent(project.project_id),
    );
    const frames = Array.isArray(frameResult) ? frameResult : frameResult.frames;
    assert.ok(
      Array.isArray(frames) && frames.length,
      'No verification frame to resume; fields: ' + Object.keys(frameResult),
    );
    const frame = frames.sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    )[0];
    submitted = {root_frame_id: frame.root_frame_id || frame.id};
  } else {
    const project = await api('/api/projects', {name: '本地接入验证'});
    submitted = await api(`/api/projects/${project.project_id}/request`, {
      input_data: {
        request:
          'Connection test only. Reply with exactly SCIENCE_LOCAL_OK. Do not use tools or create files.',
      },
      model: alias,
      plan_mode: false,
      ultra_mode: false,
      verifier_mode: 'off',
    });
    assert.equal(submitted.status, 'accepted');
  }
  let final;
  for (let i = 0; i < 180; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const frame = await api('/api/frames/' + submitted.root_frame_id);
    if (
      [
        'completed',
        'failed',
        'cancelled',
        'awaiting_user_response',
        'awaiting_plan_approval',
      ].includes(frame.status)
    ) {
      final = frame;
      break;
    }
  }
  assert.ok(final, 'Science conversation timed out.');
  assert.equal(final.status, 'completed');
  assert.equal(
    final.output_data?.response?.trim(),
    'SCIENCE_LOCAL_OK',
    'Expected actual assistant output.',
  );
  report.chat = {
    status: final.status,
    reply: final.output_data.response,
    inputTokens: final.input_tokens,
    outputTokens: final.output_tokens,
  };
}
const output = process.argv.indexOf('--output');
if (output !== -1) {
  assert.ok(process.argv[output + 1]);
  fs.writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
