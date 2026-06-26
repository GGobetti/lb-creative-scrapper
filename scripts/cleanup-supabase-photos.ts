/**
 * Script: Limpar Supabase Storage após migração para R2
 *
 * ATENÇÃO: Execute SOMENTE após validate:migration passar sem erros.
 *
 * Uso: npm run cleanup:supabase-photos [--dry-run]
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("🗑️  Limpando Supabase Storage (portfolio/telegram/)");
  if (DRY_RUN) console.log("   [DRY-RUN]\n");

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Listar todos os arquivos
  const allFiles: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from("portfolio")
      .list("telegram", { limit: 1000, offset });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    allFiles.push(...data.map((f) => `telegram/${f.name}`));
    offset += data.length;
    if (data.length < 1000) break;
  }

  console.log(`Arquivos encontrados: ${allFiles.length}`);

  if (allFiles.length === 0) {
    console.log("✅ Nada para deletar.");
    return;
  }

  if (DRY_RUN) {
    console.log(`   [DRY] Deletaria ${allFiles.length} arquivos`);
    console.log(`   Execute sem --dry-run para deletar.`);
    return;
  }

  // Deletar em batches de 1000
  let deleted = 0;
  for (let i = 0; i < allFiles.length; i += 1000) {
    const batch = allFiles.slice(i, i + 1000);
    const { error } = await supabase.storage.from("portfolio").remove(batch);
    if (error) throw new Error(error.message);
    deleted += batch.length;
    console.log(`   Deletados: ${deleted}/${allFiles.length}`);
  }

  console.log(`\n✅ ${deleted} arquivos removidos do Supabase Storage.`);
}

main().catch((err) => {
  console.error("💥 Erro:", err.message);
  process.exit(1);
});
