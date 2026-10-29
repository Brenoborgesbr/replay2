// Replay API — Cloudflare Worker que guarda os vídeos no R2 e faz o gatilho do Apple Watch.
//
// Rotas:
//   GET    /videos               lista os vídeos (mais novos primeiro)
//   PUT    /videos/:nome         envia um vídeo (corpo = arquivo)
//   GET    /videos/:nome         assiste/baixa (aceita Range, necessário no iPhone). ?download=1 força download
//   DELETE /videos/:nome         exclui
//   POST   /trigger              Apple Watch / Atalhos: "salvar lance agora"
//   GET    /trigger              a página consulta a hora do último toque
//
// Se o segredo APP_TOKEN existir, as rotas que mudam algo (PUT, DELETE, POST /trigger)
// exigem o cabeçalho  Authorization: Bearer <APP_TOKEN>  (ou ?token=<APP_TOKEN>).

const PREFIX = 'videos/';
const TRIGGER_KEY = '_sys/trigger.json';
const NAME_OK = /^[\w.-]{1,200}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function authorized(request, env, url) {
  if (!env.APP_TOKEN) return true;
  const h = request.headers.get('Authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  return given === env.APP_TOKEN;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const path = url.pathname.replace(/\/+$/, '') || '/';
    const writes = method === 'PUT' || method === 'DELETE' || method === 'POST';
    if (writes && !authorized(request, env, url)) return json({ error: 'token inválido' }, 401);

    try {
      if (path === '/' ) return json({ ok: true, app: 'replay-api' });

      // ---- Gatilho remoto (Apple Watch) ----
      if (path === '/trigger') {
        if (method === 'POST' || method === 'PUT') {
          const pressed_at = new Date().toISOString();
          await env.BUCKET.put(TRIGGER_KEY, JSON.stringify({ pressed_at }), {
            httpMetadata: { contentType: 'application/json' },
          });
          return json({ ok: true, pressed_at });
        }
        if (method === 'GET') {
          const obj = await env.BUCKET.get(TRIGGER_KEY);
          return json(obj ? await obj.json() : { pressed_at: null });
        }
        return json({ error: 'método não permitido' }, 405);
      }

      // ---- Lista ----
      if (path === '/videos' && method === 'GET') {
        const files = [];
        let cursor;
        do {
          const page = await env.BUCKET.list({ prefix: PREFIX, cursor, include: ['httpMetadata'] });
          for (const o of page.objects) {
            const name = o.key.slice(PREFIX.length);
            // o app nomeia "replay-2026-10-29T14-03-22-xxxx.webm" (hora UTC): usa essa data se houver
            const s = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
            files.push({
              name,
              size: o.size,
              created_at: s ? `${s[1]}T${s[2]}:${s[3]}:${s[4]}.000Z` : o.uploaded.toISOString(),
              type: o.httpMetadata?.contentType || null,
            });
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        files.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return json(files);
      }

      // ---- Um vídeo ----
      const m = path.match(/^\/videos\/(.+)$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        if (!NAME_OK.test(name)) return json({ error: 'nome inválido' }, 400);
        const key = PREFIX + name;

        if (method === 'PUT' || method === 'POST') {
          const type = (request.headers.get('Content-Type') || 'video/webm').split(';')[0];
          await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: type } });
          return json({ ok: true, name });
        }

        if (method === 'DELETE') {
          await env.BUCKET.delete(key);
          return json({ ok: true, deleted: [name] });
        }

        if (method === 'GET' || method === 'HEAD') {
          const obj = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
          if (!obj) return json({ error: 'não encontrado' }, 404);

          const headers = new Headers(CORS);
          obj.writeHttpMetadata(headers);
          headers.set('ETag', obj.httpEtag);
          headers.set('Accept-Ranges', 'bytes');
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          if (url.searchParams.has('download')) {
            headers.set('Content-Disposition', `attachment; filename="${name}"`);
          }
          if (!('body' in obj)) return new Response(null, { status: 304, headers }); // onlyIf não bateu

          let status = 200;
          if (obj.range && request.headers.has('Range')) {
            const r = obj.range;
            const suffix = r.suffix != null ? Math.min(r.suffix, obj.size) : null;
            const start = suffix != null ? obj.size - suffix : (r.offset ?? 0);
            const len = suffix != null ? suffix : Math.min(r.length ?? obj.size - start, obj.size - start);
            headers.set('Content-Range', `bytes ${start}-${start + len - 1}/${obj.size}`);
            headers.set('Content-Length', String(len));
            status = 206;
          } else {
            headers.set('Content-Length', String(obj.size));
          }
          return new Response(method === 'HEAD' ? null : obj.body, { status, headers });
        }
      }

      return json({ error: 'rota não encontrada' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};
