import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export const help = `Usage: node src/cli.js <install|upgrade|rollback|doctor|restart|uninstall> [options]
  --model <catalog-id>      Initial/default model; select other models inside Science
                           Required for unattended first install
  --gateway <loopback-url>  Defaults to Magpie settings port, then 3425
  --magpie <executable>     Also MAGPIE_BIN, PATH, or the macOS app
  --science <executable>    Also SCIENCE_BIN, PATH, or the installed runtime/app
  --science-port <port> --preview-port <port> --bridge-port <port>
  SCIENCE_LOCAL_HOME       Optional runtime directory (Windows default: project/.science-local-runtime)
  --help                   Show help without modifying anything
`;
const keys = {
  '--model': 'model',
  '--gateway': 'gateway',
  '--magpie': 'magpie',
  '--science': 'science',
  '--science-port': 'sciencePort',
  '--preview-port': 'sandboxPort',
  '--bridge-port': 'bridgePort',
};
export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return {command: 'help'};
  const result = {command: args[0] || 'help'};
  if (
    !['help', 'install', 'upgrade', 'rollback', 'doctor', 'restart', 'uninstall'].includes(
      result.command,
    )
  )
    throw Error('Unknown command: ' + result.command);
  for (let i = 1; i < args.length; i++) {
    const key = keys[args[i]];
    if (!key) throw Error('Unknown option: ' + args[i]);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw Error('Missing value for ' + args[i - 1]);
    if (Object.hasOwn(result, key)) throw Error('Duplicate option: ' + args[i - 1]);
    result[key] = key.endsWith('Port') ? port(value) : value;
  }
  return result;
}
function port(value) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1 || n > 65535)
    throw Error('Invalid port: ' + value);
  return n;
}
export function resolveGateway({gateway, settings = {}} = {}) {
  const url = new URL(gateway || `http://127.0.0.1:${port(settings.port ?? 3425)}`);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('Gateway must be a loopback HTTP(S) origin');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}
export async function selectModel({models, requested, previous, choose}) {
  const ids = [...new Set(models.map((x) => (typeof x === 'string' ? x : x.id)).filter(Boolean))];
  if (requested) {
    if (!ids.includes(requested)) throw Error('Model is not in the Magpie catalog: ' + requested);
    return requested;
  }
  if (ids.includes(previous)) return previous;
  if (!choose)
    throw Error('Choose a model with --model <catalog-id> (available: ' + ids.join(', ') + ')');
  if (!ids.length) throw Error('Magpie catalog has no enabled models');
  const selected = await choose(ids);
  if (!ids.includes(selected)) throw Error('Selection is not in the Magpie catalog');
  return selected;
}
export function discoverBinary(
  kind,
  {explicit, env = process.env, home, platform = process.platform} = {},
) {
  const windows = platform === 'win32';
  const name = kind === 'magpie' ? 'magpie' : 'claude-science';
  const names = windows
    ? kind === 'magpie'
      ? [
          'magpie-cli-windows-amd64.exe',
          'magpie-cli-windows-arm64.exe',
          'magpie.exe',
          'magpie-windows-amd64.exe',
          'magpie-windows-arm64.exe',
          name,
        ]
      : ['claude-science.exe', name]
    : [name];
  const specified = explicit || env[kind === 'magpie' ? 'MAGPIE_BIN' : 'SCIENCE_BIN'];
  const candidates = specified
    ? [path.resolve(specified)]
    : [
        ...(env.PATH || '')
          .split(windows ? ';' : path.delimiter)
          .filter(Boolean)
          .flatMap((p) => names.map((n) => path.resolve(p, n))),
        ...(windows
          ? kind === 'magpie'
            ? [
                path.join(home, 'Desktop', 'magpie-cli-windows-amd64.exe'),
                path.join(home, 'Desktop', 'magpie-cli-windows-arm64.exe'),
                path.join(home, 'Desktop', 'magpie-windows-amd64.exe'),
                path.join(home, 'Desktop', 'magpie-windows-arm64.exe'),
                path.join(home, 'AppData', 'Local', 'Programs', 'Magpie', 'magpie.exe'),
              ]
            : [
                path.join(
                  home,
                  'AppData',
                  'Local',
                  'Programs',
                  'ClaudeScience',
                  'claude-science.exe',
                ),
                path.join(home, '.claude-science', 'bin', 'claude-science.exe'),
              ]
          : kind === 'magpie'
            ? ['/Applications/magpie.app/Contents/MacOS/magpie']
            : [
                path.join(home, '.claude-science', 'bin', 'claude-science'),
                '/Applications/Claude Science.app/Contents/Resources/bin/claude-science',
              ]),
      ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  throw Error(`Cannot find executable ${name}; use --${kind} <path>`);
}
export async function reservePorts(
  explicit = {},
  defaults = {sciencePort: 19080, sandboxPort: 19081, bridgePort: 19082},
) {
  const servers = [],
    ports = {};
  const bind = (port) =>
    new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => resolve(s));
    });
  const release = () => Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  try {
    for (const key of ['sciencePort', 'sandboxPort', 'bridgePort']) {
      let server;
      try {
        server = await bind(explicit[key] ?? defaults[key] ?? 0);
      } catch (error) {
        if (explicit[key] !== undefined || error.code !== 'EADDRINUSE')
          throw Error(`Port ${explicit[key] ?? defaults[key]} is in use or unavailable`);
        server = await bind(0);
      }
      servers.push(server);
      ports[key] = server.address().port;
    }
  } catch (error) {
    await release();
    throw error;
  }
  return {ports, release};
}
