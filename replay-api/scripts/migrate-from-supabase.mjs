// Copia os vídeos que já estão no Supabase para o R2 (pelo Worker).
// Uso:
//   API_URL=https://replay-api.SEU-USUARIO.workers.dev  APP_TOKEN=seu-token  node scripts/migrate-from-supabase.mjs
// (no PowerShell:  $env:API_URL="..."; $env:APP_TOKEN="..."; node scripts/migrate-from-supabase.mjs)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://iojoxxpfrbzemlxjscbe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_WYMIMsXMDfEjOx05IQlpMQ_TCoVSZ5Z';
const BUCKET = process.env.SUPABASE_BUCKET || 'replays';
const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const APP_TOKEN = process.env.APP_TOKEN || '';

if (!API_URL) { console.error('Defina API_URL (endereço do Worker).'); process.exit(1); }

const sb = { apikey: SUPABASE_KEY };
if (SUPABASE_KEY.startsWith('eyJ')) sb.Authorization = 'Bearer ' + SUPABASE_KEY;
const auth = APP_TOKEN ? { Authorization: 'Bearer ' + APP_TOKEN } : {};

const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
  method: 'POST',
  headers: { ...sb, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix: '', limit: 1000, sortBy: { column: 'created_at', order: 'asc' } }),
});
if (!listRes.ok) { console.error('Erro ao listar no Supabase:', await listRes.text()); process.exit(1); }
const files = (await listRes.json()).filter(f => f.name && f.id);

const existing = new Set((await (await fetch(`${API_URL}/videos`)).json()).map(f => f.name));
console.log(`${files.length} vídeos no Supabase, ${existing.size} já no R2.`);

let ok = 0, skip = 0, fail = 0;
for (const f of files) {
  if (existing.has(f.name)) { skip++; continue; }
  try {
    const src = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(f.name)}`);
    if (!src.ok) throw new Error('download ' + src.status);
    const body = Buffer.from(await src.arrayBuffer());
    const type = f.metadata?.mimetype || src.headers.get('content-type') || 'video/webm';
    const up = await fetch(`${API_URL}/videos/${encodeURIComponent(f.name)}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': type }, body,
    });
    if (!up.ok) throw new Error('upload ' + up.status + ' ' + await up.text());
    ok++; console.log('✔', f.name, (body.length / 1048576).toFixed(1) + ' MB');
  } catch (e) { fail++; console.log('✖', f.name, e.message); }
}
console.log(`Pronto: ${ok} copiados, ${skip} já existiam, ${fail} falharam.`);
