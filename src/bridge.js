import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {aliasPrefix, modelAlias, availableModels, displayName, validModel} from './models.js';

export const shells = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
// Science also makes internal requests (for example titles using claude-haiku-5-5
// in 0.1.70) that are not in its UI catalog. These follow the last selected model.
const isAlias = (model) =>
  typeof model === 'string' && /^claude-[a-z0-9][a-z0-9._-]{0,127}$/.test(model);
export function validateConfig(c) {
  const u = new URL(c.gateway);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    !['127.0.0.1', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !['', '/'].includes(u.pathname)
  )
    throw Error('Gateway must be a literal loopback origin');
  if (c.models !== undefined && !Array.isArray(c.models)) throw Error('Invalid model catalog');
  if (c.models === undefined && !validModel(c.model)) throw Error('Invalid upstream model');
  if (typeof c.key !== 'string' || !/^[\x21-\x7e]+$/.test(c.key))
    throw Error('Invalid gateway key');
  if (typeof c.token !== 'string' || !c.token) throw Error('Local token required');
  return c;
}
export function catalog(c) {
  const data = availableModels(c).map((model) => ({
    id: modelAlias(model.id),
    type: 'model',
    display_name: displayName(model),
    created_at: '2026-10-24T00:00:00Z',
    max_input_tokens: model.context > 0 ? model.context : 200000,
    context_window: model.context > 0 ? model.context : 200000,
    max_tokens: model.output > 0 ? model.output : 16384,
  }));
  return {data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null};
}
function json(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
}
function error(res, status, message) {
  json(res, status, {
    type: 'error',
    error: {type: status === 401 ? 'authentication_error' : 'invalid_request_error', message},
  });
}
function same(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function restore(line, model) {
  if (!line.startsWith('data:')) return line;
  try {
    const obj = JSON.parse(line.slice(5));
    if (obj.type === 'message_start' && obj.message) obj.message.model = model;
    return 'data: ' + JSON.stringify(obj);
  } catch {
    return line;
  }
}

export function createBridge(readConfig, {initialModel, onSelectedModel} = {}) {
  let lastModel = initialModel;
  return http.createServer(async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      const c = validateConfig(readConfig());
      const token =
        (req.headers.authorization || '').replace(/^Bearer /, '') || req.headers['x-api-key'] || '';
      if (!same(String(token), c.token)) return error(res, 401, 'Local Science token required');
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/v1/models') return json(res, 200, catalog(c));
      if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
        const model = catalog(c).data.find(
          (m) => m.id === decodeURIComponent(url.pathname.slice(11)),
        );
        return model ? json(res, 200, model) : error(res, 404, 'Unknown model');
      }
      if (
        req.method !== 'POST' ||
        !['/v1/messages', '/v1/messages/count_tokens'].includes(url.pathname)
      )
        return error(res, 404, 'Unsupported Science endpoint');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          error(res, 413, 'Request exceeds 32 MiB');
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks));
      } catch {
        return error(res, 400, 'Invalid JSON');
      }
      if (!body || typeof body !== 'object' || typeof body.model !== 'string')
        return error(res, 400, 'Unknown Science model alias');
      const asked = body.model,
        models = availableModels(c);
      const picked = models.find((m) => modelAlias(m.id) === asked || m.id === asked);
      const fallback =
        models.find((m) => m.id === lastModel) || models.find((m) => m.id === c.model) || models[0];
      // Never silently redirect a removed model alias to a different provider.
      const target = picked || (!asked.startsWith(aliasPrefix) && isAlias(asked) ? fallback : null);
      if (!target) return error(res, 400, 'Science model is unavailable; refresh the model list');
      body.model = target.id;
      if (
        picked &&
        url.pathname === '/v1/messages' &&
        Array.isArray(body.tools) &&
        body.tools.length &&
        lastModel !== picked.id
      ) {
        lastModel = picked.id;
        onSelectedModel?.(picked.id);
      }
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${c.key}`,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        'user-agent': 'claude-science-local-for-magpie/0.3',
      };
      if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'];
      const upstream = await fetch(c.gateway.replace(/\/$/, '') + url.pathname, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abort.signal,
        redirect: 'error',
      });
      const contentType = upstream.headers.get('content-type') || 'application/json';
      res.writeHead(upstream.status, {'content-type': contentType, 'cache-control': 'no-store'});
      if (contentType.includes('text/event-stream') && upstream.body) {
        const decoder = new TextDecoder();
        let pending = '';
        for await (const chunk of upstream.body) {
          pending += decoder.decode(chunk, {stream: true});
          let index;
          while ((index = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, index);
            pending = pending.slice(index + 1);
            if (!res.write(restore(line, asked) + '\n'))
              await new Promise((resolve, reject) => {
                const done = () => {
                  res.off('close', closed);
                  resolve();
                };
                const closed = () => {
                  res.off('drain', done);
                  reject(Error('Client disconnected'));
                };
                res.once('drain', done);
                res.once('close', closed);
              });
          }
        }
        pending += decoder.decode();
        if (pending) res.write(restore(pending, asked));
        res.end();
      } else {
        const text = await upstream.text();
        try {
          const value = JSON.parse(text);
          if (value.type === 'message') value.model = asked;
          res.end(JSON.stringify(value));
        } catch {
          res.end(text);
        }
      }
    } catch (e) {
      if (!res.headersSent)
        error(
          res,
          502,
          e.name === 'AbortError'
            ? 'Request cancelled'
            : 'Science bridge unavailable; check local configuration and Magpie',
        );
      else res.destroy();
    }
  });
}
