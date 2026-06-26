# Deep Dive: Migração de Fotos para Cloudflare R2

## Status: ✅ CONCLUÍDA (2026-06-26)

---

## O Problema Original

Supabase Storage atingiu 103% do limite de egress (5.132 GB / 5 GB). O site ficou com as fotos bloqueadas.

```
Storage: 236 MB / 1 GB     ← ok
Egress:  5.132 GB / 2 GB   ← BLOQUEADO (103%)
```

**Causa:** cada acesso ao site faz download das fotos via Supabase, consumindo egress. Com bots, crawlers e usuários reais, 5 GB/mês é ultrapassado facilmente.

---

## A Solução Implementada

### Arquitetura atual

```
Antes:
  Browser → Supabase Storage (egress limitado, pago)

Depois:
  Browser → /api/photo (Next.js proxy) → R2 (egress zero, gratuito)
```

### Por que proxy Next.js e não URL direta do R2?

R2 tem dois endpoints:

| Endpoint | Formato | Autenticação |
|---|---|---|
| `r2.cloudflarestorage.com` | S3 API | Obrigatória — não serve arquivos publicamente |
| `pub-xxx.r2.dev` | CDN público | Opcional — precisa ativar no dashboard Cloudflare |

Usamos o proxy porque o `r2.dev` exporia **também os STLs** (que estão no mesmo bucket `lb-stls`) a qualquer pessoa com o URL direto — bypassando o sistema de créditos.

**Trade-off:** fotos passam pelo Next.js server na primeira requisição, depois são cacheadas pelo CDN da Vercel por 1 ano (`Cache-Control: public, max-age=31536000, immutable`). Na prática não tem custo relevante.

---

## O Que Foi Feito

### 1. Limpeza de órfãos (pré-migração)
Deletados **20.967 arquivos** órfãos do Supabase Storage — fotos que tinham sido uploadadas mas cujo STL nunca foi criado. Storage caiu de 2.6 GB → 236 MB.

### 2. Snapshot de segurança
`backups/migration-2026-06-25/urls-snapshot.json` — snapshot de todas as URLs antes de qualquer alteração (971 thumbnails, 1498 URLs em arrays).

### 3. Migração de fotos para R2
**1.377 de 1.402 fotos** migradas de `portfolio/telegram/` (Supabase) → `photos/` (R2 bucket `lb-stls`).

As 25 que falharam com HTTP 400 já eram órfãs — não existiam no Supabase, só as referências no banco.

### 4. Atualização do banco
- **937 `thumbnail_url`** atualizadas: `supabase.co/.../photo_xxx.jpg` → `/api/photo?key=photos%2Fphoto_xxx.jpg`
- **936 arrays `photos`** atualizados com o mesmo padrão

### 5. Limpeza do Supabase Storage
**1.269 arquivos** deletados de `portfolio/telegram/`. O que sobrou:
- `portfolio/telegram/manual/` — 5 STLs com UUID, uploadados manualmente. **Preservados intencionalmente.**

### 6. Proxy de fotos (`/api/photo`)
Criado em **dois repos** (ambos precisam ter a rota):
- `lb-creative-scrapper/src/app/api/photo/route.ts` — dashboard/scraper
- `lb-creative-studio/src/app/api/photo/route.ts` — site público (o que o Vercel deploya)

### 7. Scraper atualizado
`src/scraper/core.ts` agora faz upload de **novas fotos direto para R2** (não mais Supabase). Usa `uploadPhotoToR2()` de `src/lib/r2-photos.ts`.

---

## Estrutura de Arquivos no R2 (bucket `lb-stls`)

```
lb-stls/
  stl/        ← arquivos STL (já existia, não mudou)
  photos/     ← fotos dos modelos (migradas aqui)
  avatars/    ← não migrado (avatar é de perfil de usuário, sistema de auth)
```

---

## URLs

| Tipo | Formato |
|---|---|
| Antes (Supabase) | `https://yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio/telegram/photo_xxx.jpg` |
| Depois (proxy) | `/api/photo?key=photos%2Fphoto_xxx.jpg` |
| Upgrade futuro | `https://pub-xxx.r2.dev/photos/photo_xxx.jpg` (se separar bucket de STLs) |

---

## Upgrade Futuro (opcional)

Para servir fotos **direto pelo CDN da Cloudflare** sem passar pelo Next.js:

1. Criar bucket separado `lb-photos` (só fotos, sem STLs)
2. Habilitar **Public Access** no Cloudflare Dashboard → R2 → `lb-photos` → Settings
3. Obter URL `pub-xxx.r2.dev`
4. Adicionar `R2_PUBLIC_URL=https://pub-xxx.r2.dev` no Vercel
5. A função `getR2Url()` em `src/lib/r2-photos.ts` já usa essa variável automaticamente

Sem esse upgrade, o proxy Next.js funciona corretamente — apenas com um hop extra no servidor.

---

## Scripts de Manutenção

```bash
npm run snapshot:urls           # Snapshot de URLs (usar antes de migrations)
npm run migrate:photos-to-r2    # Backfill fotos Supabase → R2 (--dry-run disponível)
npm run update-photo-urls       # Atualizar URLs no banco (--dry-run disponível)
npm run validate:migration      # Verificar que nenhuma URL ainda aponta pra Supabase
npm run cleanup:supabase-photos # Deletar fotos do Supabase Storage (após validação)
npm run cleanup:orphans         # Deletar fotos órfãs do Supabase (sem STL associado)
```

---

## Rollback de Emergência

O snapshot `backups/migration-2026-06-25/urls-snapshot.json` tem todas as URLs originais.

Para reverter URLs no banco (as fotos ainda estão em R2, só muda para onde o banco aponta):

```sql
-- Reverter thumbnails
UPDATE telegram_indexed_stls
SET thumbnail_url = regexp_replace(
  thumbnail_url,
  '/api/photo\?key=photos%2F',
  'https://yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio/telegram/'
)
WHERE thumbnail_url LIKE '/api/photo%';
```

> ⚠️ Reverter URLs para Supabase só faz sentido se as fotos ainda existirem lá. Após a limpeza de 2026-06-26, elas não existem mais no Supabase.
