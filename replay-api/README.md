# replay-api

Backend do app **Replay** na Cloudflare: um Worker que guarda os vídeos no **R2** e recebe o toque do **Apple Watch**.
Substitui o Supabase (Storage + tabela `replay_trigger`).

| Rota | O que faz |
|---|---|
| `GET /videos` | lista os vídeos (mais novos primeiro) |
| `PUT /videos/:nome` | envia um vídeo |
| `GET /videos/:nome` | assiste (com suporte a Range, exigido pelo iPhone); `?download=1` baixa |
| `DELETE /videos/:nome` | exclui |
| `POST /trigger` | Apple Watch / Atalhos: "salvar lance agora" |
| `GET /trigger` | a página consulta a cada 1,5 s |

## 1. Publicar (uma vez, ~5 min)

Precisa de Node 18+ e uma conta Cloudflare (o plano grátis basta: R2 tem 10 GB grátis e não cobra tráfego de saída).

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create replays
npx wrangler secret put APP_TOKEN
npx wrangler deploy
```

- No `secret put`, digite uma senha qualquer (ex.: `replay-8f3k2q`). Ela protege envio, exclusão e o gatilho.
- Na primeira vez que ativar o R2, a Cloudflare pede para habilitá-lo no painel (R2 → *Enable*); no plano grátis pode pedir um cartão, mas não cobra dentro da franquia.
- O `deploy` mostra o endereço, algo como `https://replay-api.SEU-USUARIO.workers.dev`.

Teste: abra `https://replay-api.SEU-USUARIO.workers.dev/videos` no navegador → deve aparecer `[]`.

## 2. Ligar o app (o `index.html` na raiz deste repositório)

No `index.html`, troque as duas linhas:

```js
const API_URL   = 'https://replay-api.SEU-USUARIO.workers.dev';
const APP_TOKEN = 'replay-8f3k2q';   // o mesmo do passo 1
```

Faça commit/push e pronto.

## 3. Trazer os vídeos que já estão no Supabase (opcional)

PowerShell:

```powershell
$env:API_URL="https://replay-api.SEU-USUARIO.workers.dev"; $env:APP_TOKEN="replay-8f3k2q"; npm run migrate
```

Pode rodar de novo sem duplicar nada (pula o que já existe). As datas originais são mantidas.
Depois de conferir a lista no app, você pode desligar o projeto no Supabase.

## 4. Apple Watch (app Atalhos)

Apague o atalho antigo (que apontava para o Supabase) e crie um novo no iPhone:

1. **Atalhos** → **+** → nome: **Salvar Lance**.
2. Adicione a ação **Obter Conteúdo do URL**:
   - URL: `https://replay-api.SEU-USUARIO.workers.dev/trigger`
   - Método: **POST**
   - Cabeçalhos → adicionar: `Authorization` = `Bearer replay-8f3k2q`
3. (Opcional) Adicione **Mostrar Notificação** com o texto "Lance salvo".
4. Toque no **ⓘ** do atalho → ligue **Mostrar no Apple Watch**.
5. No relógio: abra o app Atalhos, ou adicione o atalho como **complicação** no mostrador para um toque só.

Com a página do Replay aberta e gravando (no iPhone/iPad no tripé), cada toque no relógio salva os últimos segundos.

Alternativa sem cabeçalho: URL `https://replay-api.SEU-USUARIO.workers.dev/trigger?token=replay-8f3k2q`, método POST.

## Rodar local

```bash
echo APP_TOKEN=teste123 > .dev.vars
npx wrangler dev
```

## Observações

- O `APP_TOKEN` fica visível no `index.html` (o site é público), igual à chave do Supabase antes. Ele impede uso casual, não um ataque determinado. Para proteger de verdade, coloque o site atrás do **Cloudflare Access**.
- Limite de envio do Worker grátis: 100 MB por vídeo (um clipe de 60 s a 5 Mbps tem ~40 MB).
- Custo estimado: R$ 0 no uso normal (franquias grátis: 10 GB armazenados, 1 milhão de gravações e 10 milhões de leituras por mês, 100 mil requisições/dia no Worker).
