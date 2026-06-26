# Migração de Fotos: Supabase Storage → Cloudflare R2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover ~1.402 fotos de Supabase Storage para Cloudflare R2, eliminando limite de egress (5GB/mês) e integrando com infraestrutura R2 já existente para STLs.

**Architecture:** R2 é a origem única para todos os arquivos (STLs + fotos + avatars). Mesmo bucket `lb-stls` com prefixos: `stl/`, `photos/`, `avatars/`. Scraper faz upload direto em R2. URLs no banco apontam para R2. Supabase Storage esvaziado (apenas banco de dados continua).

**Tech Stack:** Cloudflare R2, AWS SDK S3 (compatível com R2), Supabase (banco), Next.js API routes.

## Global Constraints

- R2 credenciais: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (não `AWS_*`)
- Bucket único: `lb-stls` (prefixos: `stl/`, `photos/`, `avatars/`)
- Fotos migradas: 1.377/1.402 únicas (25 já eram órfãs/inexistentes em Supabase)
- Registros atualizados: 937 thumbnails, 936 arrays de fotos
- URLs R2: `https://<accountid>.r2.cloudflarestorage.com/lb-stls/photos/<filename>`
- pasta `telegram/manual/` no Supabase preservada — contém 5 STLs manuais (UUIDs)

## Status de Execução — ✅ CONCLUÍDA (2026-06-26)

- [x] Task 0: Snapshot de URLs (`backups/migration-2026-06-25/urls-snapshot.json`) ✅
- [x] Task 2: `src/lib/r2-photos.ts` criado ✅
- [x] Task 3: 1.377 fotos migradas para R2 ✅
- [x] Task 4: `src/scraper/core.ts` modificado — novas fotos vão para R2 ✅
- [x] Task 5: URLs no banco atualizadas (937 thumbnails + 936 arrays) ✅
- [x] Task 5b: URLs convertidas para formato proxy `/api/photo?key=photos%2F...` ✅
- [x] Task 6: Supabase Storage limpo (1.269 arquivos deletados) ✅
- [x] Validação: `npm run validate:migration` — PASSOU ✅
- [x] Proxy `/api/photo` adicionado em `lb-creative-scrapper` e `lb-creative-studio` ✅
- [x] Site em produção carregando fotos corretamente ✅
- [~] Task 7: Avatars — avatar existente é de perfil de usuário (Supabase Auth), fora do escopo
- [~] Task 10: Rollback — não necessário, migração estável

---

## File Structure

**New files (Backup & Validation):**
- `scripts/snapshot-urls.ts` — Snapshot pré-migração
- `scripts/validate-pre-migration.ts` — Validação pré-migração
- `scripts/validate-migration.ts` — Validação pós-migração
- `scripts/checkpoint-files-in-r2.ts` — Checkpoint após backfill
- `scripts/checkpoint-urls-updated.ts` — Checkpoint após update
- `scripts/test-restore-backup.ts` — Test de restauração
- `scripts/rollback-urls-to-supabase.ts` — Rollback emergência
- `backups/migration-YYYY-MM-DD/` — Pasta para backups SQL

**New files (Migração):**
- `scripts/migrate-photos-to-r2.ts` — Backfill de fotos existentes (Supabase → R2)
- `scripts/migrate-avatars-to-r2.ts` — Backfill de avatars
- `src/lib/r2-photos.ts` — Funções auxiliares para upload/download
- `tests/lib/r2-photos.test.ts` — Testes unitários

**Modified files:**
- `src/scraper/core.ts` — Modificar upload de fotos para usar R2 ao invés de Supabase
- `src/lib/r2.ts` — Estender para incluir funções genéricas compartilhadas
- `package.json` — Adicionar scripts de migração, backup, validation

---

## Task 0: Backup e Snapshot Pré-Migração (CRÍTICO)

**Files:**
- Create: `scripts/snapshot-urls.ts`
- Create: `scripts/validate-pre-migration.ts`
- Create: `scripts/test-restore-backup.ts`
- Create: `backups/migration-2026-06-25/` (pasta)

**Interfaces:**
- Consumes: Banco de dados (snapshot)
- Produces: Backup SQL + Snapshot JSON + Validação

⚠️ **ESTE TASK DEVE SER EXECUTADO PRIMEIRO, ANTES DE QUALQUER COISA**

- [ ] **Step 1: Criar pasta de backups**

```bash
mkdir -p backups/migration-2026-06-25
```

- [ ] **Step 2: Fazer backup SQL completo**

```bash
# Substituir credenciais reais
PGPASSWORD="sua-senha" pg_dump \
  -h db.yruoiwtnxopcbiiuvxxa.supabase.co \
  -U postgres \
  -d postgres \
  > backups/migration-2026-06-25/pre-migration.sql

# Verificar tamanho (deve ser > 5 MB)
ls -lh backups/migration-2026-06-25/pre-migration.sql
```

Esperado: arquivo de vários MB

- [ ] **Step 3: Implementar e rodar snapshot de URLs**

Copiar código de `MIGRATION_ZERO_RISK.md` → `scripts/snapshot-urls.ts`

```bash
npm run snapshot:urls
```

Esperado: `backups/migration-2026-06-25/urls-snapshot.json` criado

- [ ] **Step 4: Implementar e rodar validação pré-migração**

Copiar código de `MIGRATION_ZERO_RISK.md` → `scripts/validate-pre-migration.ts`

```bash
npm run validate:pre-migration
```

Esperado: Todas as validações passarem (R2 acessível, banco ok, URLs em Supabase)

- [ ] **Step 5: Implementar test de restauração**

Copiar código de `MIGRATION_ZERO_RISK.md` → `scripts/test-restore-backup.ts`

```bash
npm run test:restore-backup
```

Esperado: Backup é restaurável (comprovado)

- [ ] **Step 6: Commit**

```bash
git add scripts/snapshot-urls.ts scripts/validate-pre-migration.ts scripts/test-restore-backup.ts
git add -f backups/migration-2026-06-25/  # Se quiser versionar backups (opcional, use .gitignore depois)
git commit -m "feat: add backup, snapshot, and pre-migration validation scripts

- Backup SQL completo em: backups/migration-2026-06-25/pre-migration.sql
- Snapshot de URLs antes de migração
- Validação completa pré-migração
- Test de restauração de backup
- Zero-risk strategy: todos os scripts têm failsafes"
```

---

## Task 1: Validar credenciais e configuração R2

**Files:**
- Modify: `src/lib/r2.ts` (adicionar função genérica)
- Test: Validação local

**Interfaces:**
- Consumes: Variáveis de ambiente existentes (`AWS_REGION`, `R2_BUCKET`, etc)
- Produces: Função `getR2Client()` que retorna cliente S3 configurado para R2

- [ ] **Step 1: Verificar variáveis de ambiente**

Listar `.env` ou `.env.local` para confirmar que R2 já está configurado:

```bash
grep -E "AWS|R2" /Users/ggobetti/Projetos\ Pessoais/lb-creative-scrapper/.env* 2>/dev/null || echo "Não encontrado — será preciso configurar"
```

Esperado: Ver `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID`

- [ ] **Step 2: Testar conexão ao R2**

Criar script rápido para validar:

```typescript
// scripts/test-r2-connection.ts
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const client = new S3Client({
  region: process.env.AWS_REGION || "auto",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});

const cmd = new ListBucketsCommand({});
client.send(cmd).then(() => console.log("✅ R2 conectado"))
  .catch(e => console.error("❌ Erro:", e.message));
```

Rodar: `tsx scripts/test-r2-connection.ts`

Esperado: "✅ R2 conectado"

---

## Task 2: Criar função auxiliar para fotos em R2

**Files:**
- Create: `src/lib/r2-photos.ts`
- Test: `tests/lib/r2-photos.test.ts`

**Interfaces:**
- Consumes: `@aws-sdk/client-s3`, variáveis de ambiente R2
- Produces: 
  - `uploadPhotoToR2(buffer: Buffer, filename: string): Promise<string>` → retorna URL pública
  - `deletePhotoFromR2(key: string): Promise<void>`
  - `getR2PhotoUrl(key: string): string` → URL pública sem fazer request

- [ ] **Step 1: Write failing test**

```typescript
// tests/lib/r2-photos.test.ts
import { uploadPhotoToR2, deletePhotoFromR2, getR2PhotoUrl } from "../../src/lib/r2-photos";

describe("R2 Photos", () => {
  it("should upload photo and return public URL", async () => {
    const buffer = Buffer.from("fake image data");
    const url = await uploadPhotoToR2(buffer, "test-photo.jpg");
    expect(url).toMatch(/r2\.cloudflarestorage\.com.*test-photo\.jpg/);
  });

  it("should generate correct public URL for key", () => {
    const url = getR2PhotoUrl("photos/test.jpg");
    expect(url).toContain("r2.cloudflarestorage.com");
    expect(url).toContain("photos/test.jpg");
  });

  it("should delete photo from R2", async () => {
    await expect(deletePhotoFromR2("photos/nonexistent.jpg")).resolves.not.toThrow();
  });
});
```

Run: `npm test -- tests/lib/r2-photos.test.ts`

Esperado: FAIL ("uploadPhotoToR2 is not defined")

- [ ] **Step 2: Implementar função**

```typescript
// src/lib/r2-photos.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const getR2Client = () => {
  return new S3Client({
    region: process.env.AWS_REGION || "auto",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });
};

export async function uploadPhotoToR2(buffer: Buffer, filename: string): Promise<string> {
  const client = getR2Client();
  const key = `photos/${Date.now()}-${filename}`;

  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg",
  });

  await client.send(cmd);
  return getR2PhotoUrl(key);
}

export async function deletePhotoFromR2(key: string): Promise<void> {
  const client = getR2Client();
  const cmd = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
  });

  await client.send(cmd);
}

export function getR2PhotoUrl(key: string): string {
  const accountId = process.env.R2_ACCOUNT_ID!;
  const customDomain = process.env.R2_CUSTOM_DOMAIN; // opcional: seu próprio domínio
  
  if (customDomain) {
    return `https://${customDomain}/${key}`;
  }
  
  return `https://${accountId}.r2.cloudflarestorage.com/${key}`;
}
```

- [ ] **Step 3: Run tests**

`npm test -- tests/lib/r2-photos.test.ts`

Esperado: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/r2-photos.ts tests/lib/r2-photos.test.ts
git commit -m "feat: add R2 photo upload/delete utilities"
```

---

## Task 3: Criar script de backfill (migrar fotos existentes)

**Files:**
- Create: `scripts/migrate-photos-to-r2.ts`

**Interfaces:**
- Consumes: Supabase Storage (fotos), R2 client, banco de dados
- Produces: Script que migra 1.376 fotos e atualiza URLs no banco

- [ ] **Step 1: Write script skeleton**

```typescript
// scripts/migrate-photos-to-r2.ts
/**
 * Script: Migração de fotos Supabase Storage → R2
 * 
 * Lê todas as fotos do bucket 'portfolio' no Supabase,
 * faz upload para R2, e atualiza as URLs no banco.
 * 
 * Uso: npm run migrate:photos-to-r2 [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { uploadPhotoToR2, getR2PhotoUrl } from "../src/lib/r2-photos";
import fs from "fs";
import path from "path";

const BATCH_SIZE = 10; // Processar 10 fotos por vez
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("🖼️  Migrando fotos Supabase → R2");
  if (DRY_RUN) console.log("   [DRY-RUN MODE]\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  // 1. Listar todas as fotos em Supabase
  console.log("1. Listando fotos em Supabase...");
  const allPhotos: { name: string; url: string }[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from("portfolio")
      .list("telegram", { limit: 100, offset });

    if (error) throw new Error(`Erro ao listar: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const file of data) {
      const { data: { publicUrl } } = supabase.storage
        .from("portfolio")
        .getPublicUrl(`telegram/${file.name}`);
      allPhotos.push({ name: file.name, url: publicUrl });
    }

    offset += data.length;
  }

  console.log(`   Total de fotos: ${allPhotos.length}\n`);

  // 2. Migrar em batches
  console.log("2. Migrando fotos...");
  let migrated = 0;
  let failed = 0;

  for (let i = 0; i < allPhotos.length; i += BATCH_SIZE) {
    const batch = allPhotos.slice(i, i + BATCH_SIZE);

    for (const photo of batch) {
      try {
        if (DRY_RUN) {
          console.log(`   [DRY] Migraria: ${photo.name}`);
          migrated++;
        } else {
          // Download da Supabase
          const response = await fetch(photo.url);
          const buffer = Buffer.from(await response.arrayBuffer());

          // Upload para R2
          const r2Url = await uploadPhotoToR2(buffer, photo.name);
          console.log(`   ✅ ${photo.name} → ${r2Url.split("/").pop()}`);
          migrated++;
        }
      } catch (e: any) {
        console.error(`   ❌ ${photo.name}: ${e.message}`);
        failed++;
      }
    }

    const pct = Math.round((migrated + failed) / allPhotos.length * 100);
    process.stdout.write(`\r   Progresso: ${migrated + failed}/${allPhotos.length} (${pct}%)`);
  }

  console.log(`\n\n✅ Migração concluída!`);
  console.log(`   Migradas: ${migrated}`);
  console.log(`   Falhadas: ${failed}`);

  if (DRY_RUN) {
    console.log(`\n   Execute sem --dry-run para fazer a migração de verdade.`);
  }
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar script ao package.json**

No `package.json`, adicione:

```json
"migrate:photos-to-r2": "tsx scripts/migrate-photos-to-r2.ts"
```

- [ ] **Step 3: Testar em dry-run**

```bash
npm run migrate:photos-to-r2 -- --dry-run
```

Esperado: Lista as fotos que seriam migradas, sem fazer nada

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-photos-to-r2.ts package.json
git commit -m "feat: add script to backfill photos to R2"
```

---

## Task 4: Modificar scraper para fazer upload de fotos em R2

**Files:**
- Modify: `src/scraper/core.ts` (linhas ~348-365)

**Interfaces:**
- Consumes: `uploadPhotoToR2()` da Task 2
- Produces: Fotos sendo salvas em R2 ao invés de Supabase Storage

- [ ] **Step 1: Atualizar imports**

No topo de `src/scraper/core.ts`, adicione:

```typescript
import { uploadPhotoToR2 } from "../lib/r2-photos";
```

- [ ] **Step 2: Substituir upload de Supabase por R2**

Encontre este trecho (linha ~348-365):

```typescript
const fileBuffer = fs.readFileSync(downloaded);
const uploadPath = `telegram/photo_${Date.now()}_${i}.jpg`;
const { error: upErr } = await this.supabase.storage
  .from("portfolio")
  .upload(uploadPath, fileBuffer, { contentType: "image/jpeg", upsert: true });

try { fs.unlinkSync(downloaded); } catch {}

if (upErr) { console.error(`[Core] Erro upload foto: ${upErr.message}`); continue; }

const { data: { publicUrl } } = this.supabase.storage.from("portfolio").getPublicUrl(uploadPath);
photoUrlsMap.set(photoMsg.id, publicUrl);
```

Substitua por:

```typescript
const fileBuffer = fs.readFileSync(downloaded);

try { fs.unlinkSync(downloaded); } catch {}

let publicUrl: string;
try {
  publicUrl = await uploadPhotoToR2(fileBuffer, `photo_${Date.now()}_${i}.jpg`);
  console.log(`[Core] Foto disponível em R2: ${publicUrl}`);
} catch (e: any) {
  console.error(`[Core] Erro upload foto para R2: ${e.message}`);
  continue;
}

photoUrlsMap.set(photoMsg.id, publicUrl);
```

- [ ] **Step 3: Testar scraper com nova lógica**

Rode um scan pequeno para validar:

```bash
npm run scan -- --test
```

(ou teste manualmente com um grupo pequeno)

Esperado: Fotos sendo uploadadas para R2 ao invés de Supabase

- [ ] **Step 4: Commit**

```bash
git add src/scraper/core.ts
git commit -m "refactor: upload photos to R2 instead of Supabase Storage"
```

---

## Task 5: Atualizar URLs no banco (pós-migração)

**Files:**
- Create: `scripts/update-photo-urls-in-db.ts`

**Interfaces:**
- Consumes: Banco de dados com URLs antigas de Supabase
- Produces: URLs migradas para R2 format

- [ ] **Step 1: Write script para atualizar URLs**

```typescript
// scripts/update-photo-urls-in-db.ts
/**
 * Script: Atualizar URLs de fotos de Supabase → R2
 * 
 * Substitui todas as URLs no banco que apontam para Supabase Storage
 * pelas equivalentes no R2.
 * 
 * Uso: npm run update-photo-urls -- --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { getR2PhotoUrl } from "../src/lib/r2-photos";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("🔄 Atualizando URLs de fotos no banco");
  if (DRY_RUN) console.log("   [DRY-RUN]\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  // 1. Buscar todos os STLs com thumbnail_url do Supabase
  const { data: stls, error: err1 } = await supabase
    .from("telegram_indexed_stls")
    .select("id, thumbnail_url")
    .like("thumbnail_url", "%supabase.co%");

  if (err1) throw new Error(`Erro ao buscar STLs: ${err1.message}`);

  console.log(`1. Encontrados ${stls?.length || 0} STLs com URLs Supabase\n`);

  let updated = 0;

  // 2. Atualizar thumbnail_url
  for (const stl of stls || []) {
    const oldUrl = stl.thumbnail_url;
    const filename = oldUrl.split("/").pop(); // ex: "photo_1781726163753_7.jpg"

    if (!filename) continue;

    const newUrl = getR2PhotoUrl(`photos/${filename}`);

    if (DRY_RUN) {
      console.log(`   [DRY] ${filename}`);
      console.log(`         ${oldUrl}`);
      console.log(`      → ${newUrl}\n`);
      updated++;
    } else {
      const { error: upErr } = await supabase
        .from("telegram_indexed_stls")
        .update({ thumbnail_url: newUrl })
        .eq("id", stl.id);

      if (upErr) {
        console.error(`   ❌ ${filename}: ${upErr.message}`);
      } else {
        console.log(`   ✅ ${filename}`);
        updated++;
      }
    }
  }

  // 3. Atualizar photos array
  console.log(`\n2. Atualizando arrays de fotos...`);

  const { data: allStls } = await supabase
    .from("telegram_indexed_stls")
    .select("id, photos")
    .not("photos", "is", null);

  for (const stl of allStls || []) {
    if (!stl.photos || stl.photos.length === 0) continue;

    const updatedPhotos = stl.photos.map((url: string) => {
      if (url.includes("supabase.co")) {
        const filename = url.split("/").pop();
        return getR2PhotoUrl(`photos/${filename}`);
      }
      return url;
    });

    const hasChanges = JSON.stringify(updatedPhotos) !== JSON.stringify(stl.photos);

    if (hasChanges) {
      if (DRY_RUN) {
        console.log(`   [DRY] STL ${stl.id.slice(0, 8)}: ${stl.photos.length} fotos`);
        updated++;
      } else {
        const { error: upErr } = await supabase
          .from("telegram_indexed_stls")
          .update({ photos: updatedPhotos })
          .eq("id", stl.id);

        if (!upErr) {
          console.log(`   ✅ STL ${stl.id.slice(0, 8)}: ${stl.photos.length} fotos`);
          updated++;
        }
      }
    }
  }

  console.log(`\n✅ Atualização concluída!`);
  console.log(`   Total de registros atualizados: ${updated}`);

  if (DRY_RUN) {
    console.log(`\n   Execute sem --dry-run para fazer de verdade.`);
  }
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar ao package.json**

```json
"update-photo-urls": "tsx scripts/update-photo-urls-in-db.ts"
```

- [ ] **Step 3: Testar em dry-run**

```bash
npm run update-photo-urls -- --dry-run
```

Esperado: Mostra quais URLs seriam atualizadas

- [ ] **Step 4: Commit**

```bash
git add scripts/update-photo-urls-in-db.ts package.json
git commit -m "feat: add script to update photo URLs in database"
```

---

## Task 6: Limpar Supabase Storage (após confirmação)

**Files:**
- Create: `scripts/cleanup-supabase-photos.ts`

**Interfaces:**
- Consumes: Bucket `portfolio` no Supabase Storage
- Produces: Bucket vazio (todas as fotos deletadas)

- [ ] **Step 1: Criar script de limpeza pós-migração**

```typescript
// scripts/cleanup-supabase-photos.ts
/**
 * Script: Limpar Supabase Storage após migração para R2
 * 
 * Deleta todos os arquivos do bucket 'portfolio' após confirmação
 * que foram migrados para R2.
 * 
 * Uso: npm run cleanup:supabase-photos -- --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("🗑️  Limpando Supabase Storage (pós-migração)");
  if (DRY_RUN) console.log("   [DRY-RUN]\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  // Listar todas as fotos
  const { data, error } = await supabase.storage
    .from("portfolio")
    .list("telegram", { limit: 1000 });

  if (error) throw new Error(`Erro ao listar: ${error.message}`);

  const files = data?.map(f => `telegram/${f.name}`) || [];

  console.log(`Total de fotos a deletar: ${files.length}\n`);

  if (DRY_RUN) {
    console.log(`   [DRY] Deletaria ${files.length} arquivos`);
  } else {
    if (files.length > 0) {
      const { error: delErr } = await supabase.storage
        .from("portfolio")
        .remove(files);

      if (delErr) throw new Error(`Erro ao deletar: ${delErr.message}`);
      console.log(`   ✅ ${files.length} arquivos deletados`);
    }
  }

  console.log("\n✅ Limpeza concluída!");
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar ao package.json**

```json
"cleanup:supabase-photos": "tsx scripts/cleanup-supabase-photos.ts"
```

- [ ] **Step 3: Testar em dry-run APÓS confirmar URLs foram atualizadas**

```bash
npm run cleanup:supabase-photos -- --dry-run
```

- [ ] **Step 4: Executar limpeza real (após confirmação)**

```bash
npm run cleanup:supabase-photos
```

- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-supabase-photos.ts package.json
git commit -m "feat: add script to clean up Supabase Storage after R2 migration"
```

---

## Task 7: Migrar Avatars (Supabase → R2)

**Files:**
- Create: `scripts/migrate-avatars-to-r2.ts`
- Modify: `src/lib/r2-photos.ts` (estender para avatars)

**Interfaces:**
- Consumes: Bucket `avatars` no Supabase Storage
- Produces: Avatar migrado para R2 + URL atualizada no banco

- [ ] **Step 1: Criar script de migração de avatars**

```typescript
// scripts/migrate-avatars-to-r2.ts
/**
 * Script: Migração de avatars Supabase Storage → R2
 * 
 * Migra avatars do bucket 'avatars' para R2.
 * 
 * Uso: npm run migrate:avatars-to-r2 [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { uploadPhotoToR2, getR2PhotoUrl } from "../src/lib/r2-photos";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("👤 Migrando avatars Supabase → R2");
  if (DRY_RUN) console.log("   [DRY-RUN]\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  // 1. Listar avatars
  console.log("1. Listando avatars em Supabase...");
  const { data: avatars, error } = await supabase.storage
    .from("avatars")
    .list("", { limit: 1000 });

  if (error) throw new Error(`Erro ao listar: ${error.message}`);

  const files = avatars || [];
  console.log(`   Total de avatars: ${files.length}\n`);

  if (files.length === 0) {
    console.log("✅ Nenhum avatar para migrar.");
    return;
  }

  // 2. Migrar cada avatar
  console.log("2. Migrando avatars...");
  let migrated = 0;
  let failed = 0;

  for (const file of files) {
    try {
      if (DRY_RUN) {
        console.log(`   [DRY] Migraria: ${file.name}`);
        migrated++;
      } else {
        // Download
        const { data: buffer, error: dlErr } = await supabase.storage
          .from("avatars")
          .download(file.name);

        if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);

        // Upload para R2
        const r2Url = await uploadPhotoToR2(buffer, file.name);
        console.log(`   ✅ ${file.name} → R2`);
        migrated++;
      }
    } catch (e: any) {
      console.error(`   ❌ ${file.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Migração concluída!`);
  console.log(`   Migrados: ${migrated}`);
  console.log(`   Falhados: ${failed}`);

  if (DRY_RUN) {
    console.log(`\n   Execute sem --dry-run para fazer de verdade.`);
  }
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar ao package.json**

```json
"migrate:avatars-to-r2": "tsx scripts/migrate-avatars-to-r2.ts"
```

- [ ] **Step 3: Rodar em dry-run**

```bash
npm run migrate:avatars-to-r2 -- --dry-run
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-avatars-to-r2.ts package.json
git commit -m "feat: add script to migrate avatars to R2"
```

---

## Task 8: Validar integridade pós-migração

**Files:**
- Create: `scripts/validate-migration.ts`

**Interfaces:**
- Consumes: Banco de dados com URLs atualizadas
- Produces: Relatório de validação (URLs quebradas, inconsistências)

- [ ] **Step 1: Criar script de validação**

```typescript
// scripts/validate-migration.ts
/**
 * Script: Validar integridade da migração R2
 * 
 * Verifica se todas as URLs no banco apontam para arquivos que existem em R2
 * e se não há URL quebradas ou referências orphans.
 * 
 * Uso: npm run validate:migration
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  console.log("🔍 Validando integridade da migração\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  let issues = 0;

  // 1. Verificar telegram_indexed_stls
  console.log("1. Verificando telegram_indexed_stls...");
  const { data: stls } = await supabase
    .from("telegram_indexed_stls")
    .select("id, thumbnail_url, photos");

  for (const stl of stls || []) {
    // Validar thumbnail_url
    if (stl.thumbnail_url && stl.thumbnail_url.includes("supabase.co")) {
      console.log(`   ❌ STL ${stl.id.slice(0, 8)} ainda tem URL Supabase em thumbnail`);
      issues++;
    }

    // Validar photos array
    if (stl.photos) {
      for (const url of stl.photos) {
        if (url.includes("supabase.co")) {
          console.log(`   ❌ STL ${stl.id.slice(0, 8)} tem URL Supabase em photos array`);
          issues++;
          break;
        }
      }
    }
  }

  if (issues === 0) {
    console.log(`   ✅ Todas as URLs estão em R2\n`);
  }

  // 2. Verificar que Supabase Storage está vazio ou quase vazio
  console.log("2. Verificando Supabase Storage...");
  const { data: portfolioFiles } = await supabase.storage
    .from("portfolio")
    .list("telegram", { limit: 100 });

  if (portfolioFiles && portfolioFiles.length > 0) {
    console.log(`   ⚠️  Ainda há ${portfolioFiles.length} arquivos em Supabase`);
  } else {
    console.log(`   ✅ Supabase Storage limpo\n`);
  }

  // 3. Relatório final
  if (issues === 0) {
    console.log("✅ Validação passou! Migração bem-sucedida.");
  } else {
    console.log(`\n❌ ${issues} problemas encontrados. Revise antes de fazer cleanup.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Adicionar ao package.json**

```json
"validate:migration": "tsx scripts/validate-migration.ts"
```

- [ ] **Step 3: Rodar validação**

```bash
npm run validate:migration
```

Esperado: Nenhum erro

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-migration.ts package.json
git commit -m "feat: add migration validation script"
```

---

## Task 9: Documentar e finalizar

**Files:**
- Create: `docs/MIGRATION_R2.md`
- Modify: `README.md` (se aplicável)

**Interfaces:**
- Consumes: Conhecimento do processo completo
- Produces: Documentação para futuro

- [ ] **Step 1: Criar documento de migração**

```markdown
# Migração de Fotos e Avatars para Cloudflare R2

## Resumo

Este projeto foi migrado de Supabase Storage para Cloudflare R2 para eliminar limite de egress (5 GB/mês).

## Arquitetura

- **STLs:** R2 (via `src/lib/r2.ts`)
- **Fotos:** R2 (via `src/lib/r2-photos.ts`)
- **Avatars:** R2 (via `src/lib/r2-photos.ts`)
- **Banco de dados:** Supabase PostgreSQL

## Procedimento Executado

1. ✅ Validar credenciais R2
2. ✅ Criar funções genéricas de upload/delete
3. ✅ Backfill fotos existentes (1.376 arquivos)
4. ✅ Backfill avatars (1 arquivo)
5. ✅ Atualizar URLs no banco
6. ✅ Validar integridade
7. ✅ Limpar Supabase Storage
8. ✅ Configurar scraper para R2

## URLs

- **Antes:** `https://yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio/...`
- **Depois:** `https://<account-id>.r2.cloudflarestorage.com/photos/...` (fotos) e `/avatars/...` (avatars)
- **Customizado (opcional):** `https://images.seudominio.com/...`

## Benefícios

- ✅ Sem limite de egress (10 GB grátis em R2)
- ✅ Integrado com infraestrutura R2 existente (STLs, fotos, avatars)
- ✅ Reduz dependência do Supabase Storage
- ✅ Escalável para crescimento futuro
```

- [ ] **Step 2: Commit final**

```bash
git add docs/MIGRATION_R2.md
git commit -m "docs: add R2 migration reference guide"
```

---

## Checklist de Segurança (Validar Antes de Cada Step)

**Antes de fazer backfill:**
- [ ] Dry-run passou sem erro
- [ ] Credenciais R2 validadas
- [ ] Backup do banco existe (apenas for paranoia)

**Antes de atualizar URLs no banco:**
- [ ] Todos os arquivos foram uploadados para R2
- [ ] Nenhum erro na migração
- [ ] Validação de R2 passou

**Antes de limpar Supabase:**
- [ ] Todas as URLs no banco apontam para R2
- [ ] Rodou `npm run validate:migration` — passou
- [ ] Site foi testado com novas URLs
- [ ] Nenhuma URL de Supabase permanece no banco

**Pós-limpeza:**
- [ ] Supabase Storage está vazio
- [ ] Site continua funcionando
- [ ] Novas fotos do scraper vão para R2 (teste upload)

---

## Task 10: Setup de Rollback (Emergência)

**Files:**
- Create: `scripts/rollback-urls-to-supabase.ts`
- Create: SQL functions (`revert_thumbnail_urls`, `revert_photos_array`)

**Interfaces:**
- Consumes: Banco de dados com URLs em R2
- Produces: Capacidade de reverter para URLs de Supabase

⚠️ **TASK PARA TER À MÃO EM CASO DE EMERGÊNCIA**

- [ ] **Step 1: Implementar script de rollback**

Copiar código de `MIGRATION_ZERO_RISK.md` → `scripts/rollback-urls-to-supabase.ts`

- [ ] **Step 2: Criar SQL functions no banco**

```sql
-- Conectar ao banco e rodar:

-- Função para reverter thumbnail_url
CREATE OR REPLACE FUNCTION revert_thumbnail_urls()
RETURNS void AS $$
BEGIN
  UPDATE telegram_indexed_stls
  SET thumbnail_url = regexp_replace(
    thumbnail_url,
    'https://[a-z0-9]+\.r2\.cloudflarestorage\.com/photos/',
    'https://yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio/telegram/'
  )
  WHERE thumbnail_url LIKE '%r2.cloudflarestorage%';
END;
$$ LANGUAGE plpgsql;

-- Função para reverter photos array
CREATE OR REPLACE FUNCTION revert_photos_array()
RETURNS void AS $$
BEGIN
  UPDATE telegram_indexed_stls
  SET photos = array_agg(
    CASE 
      WHEN photo LIKE '%r2.cloudflarestorage%' THEN
        regexp_replace(
          photo,
          'https://[a-z0-9]+\.r2\.cloudflarestorage\.com/photos/',
          'https://yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio/telegram/'
        )
      ELSE photo
    END
  )
  FROM (SELECT unnest(photos) as photo) sub
  WHERE photo LIKE '%r2.cloudflarestorage%';
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: Testar rollback script (em dry-mode)**

```bash
# Criar função de teste que NÃO altera banco
npm run rollback:urls-to-supabase -- --test-only
```

Esperado: Script mostra o que faria sem executar

- [ ] **Step 4: Commit**

```bash
git add scripts/rollback-urls-to-supabase.ts
git commit -m "feat: add emergency rollback script

Permite reverter URLs para Supabase em caso de problema.
Uso: npm run rollback:urls-to-supabase -- --confirm

AVISO: SÓ use em emergência!"
```

---

## Sumário das Tarefas

### Pré-Migração
- [ ] **Task 0:** Backup e Snapshot ⚠️ CRÍTICO (fazer primeiro)

### Migração Principal
- [ ] Task 1: Validar credenciais R2
- [ ] Task 2: Criar função auxiliar `r2-photos.ts`
- [ ] Task 3: Criar script de backfill de fotos
- [ ] Task 3.5: **CHECKPOINT** — Verificar arquivos em R2
- [ ] Task 4: Modificar scraper para R2
- [ ] Task 5: Criar script de atualização de URLs
- [ ] Task 5.5: **CHECKPOINT** — Verificar URLs atualizadas
- [ ] Task 6: Criar script de limpeza Supabase
- [ ] Task 7: Migrar avatars
- [ ] Task 8: Validar integridade pós-migração
- [ ] Task 9: Documentação

### Emergência
- [ ] **Task 10:** Setup de rollback (ter à mão)
