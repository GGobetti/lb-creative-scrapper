/**
 * Script: Migração de fotos Supabase Storage → R2
 *
 * Baixa cada foto do Supabase e sobe para R2 (lb-stls/photos/<filename>).
 * NÃO altera nada no banco — apenas copia arquivos.
 * Rode update-photo-urls-in-db.ts depois.
 *
 * Uso: npm run migrate:photos-to-r2 [--dry-run]
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { uploadPhotoToR2, isR2PhotosConfigured } from "../src/lib/r2-photos";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 5; // paralelo conservador para não sobrecarregar

async function main() {
  console.log("🖼️  Migrando fotos Supabase Storage → R2");
  if (DRY_RUN) console.log("   [DRY-RUN — nenhuma alteração será feita]\n");

  if (!isR2PhotosConfigured()) {
    throw new Error("Credenciais R2 não configuradas. Verifique R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, etc.");
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Coletar todas as fotos únicas do banco
  console.log("1. Coletando URLs únicas do banco...");
  const { data, error } = await supabase
    .from("telegram_indexed_stls")
    .select("thumbnail_url, photos")
    .not("thumbnail_url", "is", null);

  if (error) throw new Error(error.message);

  const urlSet = new Set<string>();
  for (const row of data || []) {
    if (row.thumbnail_url?.includes("supabase.co")) urlSet.add(row.thumbnail_url);
    for (const u of row.photos || []) {
      if (u?.includes("supabase.co")) urlSet.add(u);
    }
  }

  const urls = Array.from(urlSet);
  console.log(`   Total de fotos únicas para migrar: ${urls.length}\n`);

  if (DRY_RUN) {
    console.log("   Exemplos:");
    urls.slice(0, 5).forEach((u) => console.log(`   - ${u.split("/").pop()}`));
    if (urls.length > 5) console.log(`   ... e mais ${urls.length - 5}`);
    console.log("\n   Execute sem --dry-run para migrar.");
    return;
  }

  // 2. Migrar em batches
  console.log("2. Migrando...");
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (url) => {
        const filename = url.split("/").pop();
        if (!filename) { skipped++; return; }

        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          await uploadPhotoToR2(buffer, filename);
          migrated++;
        } catch (e: any) {
          errors.push(`${filename}: ${e.message}`);
          failed++;
        }
      })
    );

    const done = Math.min(i + BATCH_SIZE, urls.length);
    const pct = Math.round((done / urls.length) * 100);
    process.stdout.write(`\r   Progresso: ${done}/${urls.length} (${pct}%) ✅${migrated} ❌${failed}`);
  }

  console.log("\n");
  console.log(`✅ Migração concluída!`);
  console.log(`   Migradas: ${migrated}`);
  console.log(`   Puladas:  ${skipped}`);
  console.log(`   Falhas:   ${failed}`);

  if (errors.length > 0) {
    console.log("\n❌ Erros:");
    errors.slice(0, 20).forEach((e) => console.log(`   - ${e}`));
    if (errors.length > 20) console.log(`   ... e mais ${errors.length - 20}`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
