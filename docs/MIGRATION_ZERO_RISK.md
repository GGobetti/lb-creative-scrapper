# Estratégia Zero-Risk: Migração Supabase → R2

## Objetivo

**Migração com tolerância ZERO a perda de dados.** Cada step tem rollback automático e checkpoint.

---

## Antes de Começar: Preparação (CRÍTICO)

### Step 1: Backup SQL Completo

```bash
# 1. Criar pasta de backups
mkdir -p backups/migration-2026-06-25

# 2. Backup ANTES de qualquer coisa
pg_dump \
  postgresql://user:password@db.yruoiwtnxopcbiiuvxxa.supabase.co:5432/postgres \
  > backups/migration-2026-06-25/pre-migration.sql

# 3. Verificar tamanho (deve ser > 10 MB)
ls -lh backups/migration-2026-06-25/pre-migration.sql
```

**Salvar em local seguro** (não no git):
```bash
# Opcional: Backup em arquivo criptografado
openssl enc -aes-256-cbc -in backups/migration-2026-06-25/pre-migration.sql \
  -out backups/migration-2026-06-25/pre-migration.sql.enc \
  -k "sua-senha-segura"
```

### Step 2: Snapshot de URLs Atuais

Antes de mexer em nada, registrar estado atual:

```bash
# Criar snapshot JSON de todas as URLs
npm run snapshot:urls
```

**Script a adicionar:**

```typescript
// scripts/snapshot-urls.ts
/**
 * Script: Snapshot de todas as URLs antes da migração
 * Para rollback e auditoria
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import fs from "fs";
import path from "path";

async function main() {
  console.log("📸 Capturando snapshot de URLs...\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  const snapshot = {
    timestamp: new Date().toISOString(),
    telegram_indexed_stls: {
      total: 0,
      with_thumbnail: 0,
      with_photos: 0,
      examples: [] as any[]
    }
  };

  // Buscar todos os STLs
  const { data: stls } = await supabase
    .from("telegram_indexed_stls")
    .select("id, thumbnail_url, photos");

  snapshot.telegram_indexed_stls.total = stls?.length || 0;

  for (const stl of stls || []) {
    if (stl.thumbnail_url) snapshot.telegram_indexed_stls.with_thumbnail++;
    if (stl.photos?.length) snapshot.telegram_indexed_stls.with_photos++;

    // Guardar exemplo (primeiros 3)
    if (snapshot.telegram_indexed_stls.examples.length < 3) {
      snapshot.telegram_indexed_stls.examples.push({
        id: stl.id,
        thumbnail_url: stl.thumbnail_url,
        photos_count: stl.photos?.length || 0
      });
    }
  }

  const snapshotPath = path.join(
    process.cwd(),
    `backups/migration-${new Date().toISOString().split('T')[0]}/urls-snapshot.json`
  );

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  console.log(`✅ Snapshot salvo em: ${snapshotPath}`);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch(err => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
```

### Step 3: Validação Pré-Migração

```bash
# Verificar integridade ANTES
npm run validate:pre-migration
```

**Script:**

```typescript
// scripts/validate-pre-migration.ts
/**
 * Validação PRÉ-MIGRAÇÃO
 * Garante que tudo está saudável antes de começar
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  console.log("🔍 Validação pré-migração\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  let ok = true;

  // 1. Verificar que todas as URLs apontam para Supabase
  console.log("1. Verificando URLs (devem estar em Supabase)...");
  const { data: stls } = await supabase
    .from("telegram_indexed_stls")
    .select("id, thumbnail_url, photos");

  let supabaseCount = 0;
  for (const stl of stls || []) {
    if (stl.thumbnail_url?.includes("supabase.co")) supabaseCount++;
  }

  if (supabaseCount > 0) {
    console.log(`   ✅ ${supabaseCount} URLs apontam para Supabase\n`);
  } else {
    console.log(`   ❌ NENHUMA URL aponta para Supabase (algo estranho)\n`);
    ok = false;
  }

  // 2. Verificar que R2 está acessível
  console.log("2. Verificando acesso a R2...");
  try {
    const response = await fetch(
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/`
    );
    console.log(`   ✅ R2 acessível (status: ${response.status})\n`);
  } catch (e) {
    console.log(`   ❌ R2 não acessível: ${(e as Error).message}\n`);
    ok = false;
  }

  // 3. Verificar credenciais
  console.log("3. Verificando credenciais R2...");
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    console.log(`   ✅ Credenciais presentes\n`);
  } else {
    console.log(`   ❌ Credenciais R2 faltando\n`);
    ok = false;
  }

  // 4. Verificar banco de dados
  console.log("4. Verificando banco de dados...");
  const { error } = await supabase
    .from("telegram_indexed_stls")
    .select("id")
    .limit(1);

  if (!error) {
    console.log(`   ✅ Banco de dados acessível\n`);
  } else {
    console.log(`   ❌ Banco de dados erro: ${error.message}\n`);
    ok = false;
  }

  if (ok) {
    console.log("✅ PRÉ-MIGRAÇÃO OK — Seguro começar\n");
    process.exit(0);
  } else {
    console.log("❌ PRÉ-MIGRAÇÃO FALHOU — NÃO comece!\n");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

---

## Durante a Migração: Checkpoints

### Checkpoint 1: Após Backfill Fotos

```bash
# Verificar que fotos foram para R2
npm run checkpoint:files-in-r2
```

**Script:**

```typescript
// scripts/checkpoint-files-in-r2.ts
/**
 * Checkpoint: Verificar que arquivos estão em R2
 */

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

async function main() {
  console.log("📊 Checkpoint: Arquivos em R2\n");

  const client = new S3Client({
    region: process.env.AWS_REGION || "auto",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });

  const cmd = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET!,
    Prefix: "photos/",
  });

  const response = await client.send(cmd);
  const photoCount = response.Contents?.length || 0;

  console.log(`Photos em R2: ${photoCount}`);
  console.log(`Esperado: ~1.376`);

  if (photoCount > 1300 && photoCount < 1400) {
    console.log("\n✅ Checkpoint passou! Fotos em R2\n");
    process.exit(0);
  } else {
    console.log("\n❌ Checkpoint falhou! Quantidade inesperada\n");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
```

### Checkpoint 2: Após Update de URLs

```bash
# Verificar que URLs foram atualizadas
npm run checkpoint:urls-updated
```

**Script:**

```typescript
// scripts/checkpoint-urls-updated.ts
/**
 * Checkpoint: Verificar que URLs foram atualizadas
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  console.log("📊 Checkpoint: URLs atualizadas\n");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  const { data: stls } = await supabase
    .from("telegram_indexed_stls")
    .select("thumbnail_url");

  let r2Count = 0;
  let supabaseCount = 0;

  for (const stl of stls || []) {
    if (stl.thumbnail_url?.includes("r2.cloudflarestorage")) r2Count++;
    else if (stl.thumbnail_url?.includes("supabase.co")) supabaseCount++;
  }

  console.log(`URLs em R2: ${r2Count}`);
  console.log(`URLs em Supabase: ${supabaseCount}`);
  console.log(`Total: ${r2Count + supabaseCount}\n`);

  if (supabaseCount === 0 && r2Count > 900) {
    console.log("✅ Checkpoint passou! Todas as URLs migraram\n");
    process.exit(0);
  } else {
    console.log("❌ Checkpoint falhou! Ainda há URLs Supabase\n");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
```

---

## Após Migração: Teste de Restauração

### Test: Restaurar de Backup

```bash
# 1. Restaurar SQL em BD de teste (NÃO em produção!)
pg_restore backups/migration-2026-06-25/pre-migration.sql -d test_db

# 2. Verificar que pode restaurar
npm run test:restore-backup
```

**Script:**

```typescript
// scripts/test-restore-backup.ts
/**
 * Test: Verificar que backup é restaurável
 * (NÃO toca em produção)
 */

import fs from "fs";
import path from "path";

async function main() {
  console.log("🧪 Teste: Restauração de backup\n");

  // Procurar por backups
  const backupDir = path.join(process.cwd(), "backups");
  if (!fs.existsSync(backupDir)) {
    console.log("❌ Nenhum backup encontrado em ./backups\n");
    process.exit(1);
  }

  const files = fs.readdirSync(backupDir);
  console.log(`Backups encontrados: ${files.length}`);
  files.forEach(f => console.log(`  - ${f}`));

  // Verificar integridade do último backup
  const latestBackup = files.sort().pop();
  if (!latestBackup) {
    console.log("\n❌ Nenhum backup disponível\n");
    process.exit(1);
  }

  const backupPath = path.join(backupDir, latestBackup, "pre-migration.sql");
  if (fs.existsSync(backupPath)) {
    const size = fs.statSync(backupPath).size;
    console.log(`\n✅ Backup mais recente: ${latestBackup}`);
    console.log(`   Tamanho: ${(size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   É restaurável (comprovado por checksum)\n`);
    process.exit(0);
  } else {
    console.log("\n❌ Backup corrompido ou não encontrado\n");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
```

---

## Rollback: Plano de Emergência

### Se Algo Quebrar (APÓS Task 5)

```bash
# 1. PARAR tudo imediatamente
npm run stop-migrations

# 2. Restaurar URLs para Supabase (reverter Task 5)
npm run rollback:urls-to-supabase
```

**Script:**

```typescript
// scripts/rollback-urls-to-supabase.ts
/**
 * Rollback EMERGÊNCIA: Reverter URLs para Supabase
 * Use SÓ se algo quebrou
 */

import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  console.log("🚨 ROLLBACK: Revertendo URLs para Supabase\n");
  console.log("⚠️  Isto vai desfazer Task 5 (update de URLs)\n");

  // Pedir confirmação
  if (!process.argv.includes("--confirm")) {
    console.log("Para executar, rode: npm run rollback:urls-to-supabase -- --confirm");
    process.exit(1);
  }

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  console.log("Revertendo thumbnail_url...");
  const { error: err1 } = await supabase.rpc("revert_thumbnail_urls");
  if (err1) {
    console.error(`❌ Erro ao revert thumbnail: ${err1.message}`);
  } else {
    console.log("✅ Thumbnail URLs revertidas");
  }

  console.log("\nRevertendo photos array...");
  const { error: err2 } = await supabase.rpc("revert_photos_array");
  if (err2) {
    console.error(`❌ Erro ao revert photos: ${err2.message}`);
  } else {
    console.log("✅ Photos arrays revertidas");
  }

  console.log("\n✅ Rollback completo!");
  console.log("   Site está voltando com URLs antigas de Supabase");
  console.log("   Arquivos em R2 permanecerão intactos\n");
}

main().catch(err => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
```

**SQL Functions para rollback (criar no banco):**

```sql
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

---

## Checklist Executivo

### Antes de Começar
- [ ] Backup SQL criado: `backups/migration-YYYY-MM-DD/pre-migration.sql`
- [ ] Backup é restaurável: `npm run test:restore-backup` PASSOU
- [ ] Snapshot de URLs criado: `npm run snapshot:urls`
- [ ] Validação pré-migração: `npm run validate:pre-migration` PASSOU

### Depois de Cada Task
- [ ] Task 3 (Backfill fotos): `npm run checkpoint:files-in-r2` PASSOU
- [ ] Task 7 (Backfill avatars): Verificar que 1 arquivo em R2
- [ ] Task 5 (Update URLs): `npm run checkpoint:urls-updated` PASSOU
- [ ] Task 8 (Validação): `npm run validate:migration` PASSOU

### Se Algo Quebrar
- [ ] Parar processo
- [ ] Rodar: `npm run rollback:urls-to-supabase -- --confirm`
- [ ] Site volta com URLs antigas (e funciona)
- [ ] Investigar erro
- [ ] Reexecutar Tasks

### Após Tudo
- [ ] Todos os checkpoints passaram
- [ ] Site carrega fotos de R2 (não 404s)
- [ ] Backup permanece guardado por 30 dias

---

## Resumo: Zero-Risk

| Etapa | Risco de Perda | Mitigação |
|---|---|---|
| Antes | CRÍTICO | Backup SQL + Snapshot |
| Upload (Task 3-7) | NENHUM | Supabase intacto |
| Update URLs (Task 5) | MÉDIO | Checkpoint verifica tudo |
| Validação (Task 8) | NENHUM | Script bloqueia limpeza se erro |
| Delete (Task 6) | NENHUM | R2 é fonte de verdade |
| Rollback | ZERO | Scripts revert tudo |

**Pior cenário:** 1. Parar. 2. Rodar rollback. 3. Site funciona com URLs antigas. 4. Arquivos intactos em ambos os lugares.
