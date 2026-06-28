/**
 * Script: Limpeza de Fotos Órfãs do Storage
 *
 * Remove do bucket 'portfolio' todos os arquivos que não estão
 * referenciados em nenhum registro da tabela telegram_indexed_stls
 * (nem em thumbnail_url nem no array photos).
 *
 * Uso: npm run cleanup:orphans
 * Uso (dry-run): npm run cleanup:orphans -- --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const BATCH_SIZE = 1000; // Supabase Storage API aceita até 1000 por chamada
const BUCKET = "portfolio";

async function fetchOrphanPaths(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  // Busca diretamente via SQL os paths órfãos (não referenciados no banco)
  const { data, error } = await supabase.rpc("get_orphan_storage_paths");
  if (error) throw new Error(`Erro ao buscar órfãos via RPC: ${error.message}`);
  return (data as { name: string }[]).map((r) => r.name);
}

async function fetchOrphanPathsViaSQL(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  // Fallback: busca paginada de todos os arquivos e filtra no cliente
  // Isso é menos eficiente mas garante funcionar sem precisar criar função SQL
  console.log("  Buscando todos os arquivos do storage...");

  const allFiles: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .list("telegram", {
        limit: 1000,
        offset,
      });

    if (error) throw new Error(`Erro ao listar storage: ${error.message}`);
    if (!data || data.length === 0) break;

    allFiles.push(...data.map((f) => `telegram/${f.name}`));
    offset += data.length;

    if (data.length < 1000) break;
    process.stdout.write(`\r  Arquivos listados: ${allFiles.length}`);
  }
  console.log(`\r  Total no storage: ${allFiles.length} arquivos`);

  // Busca todos os paths referenciados no banco
  console.log("  Buscando fotos referenciadas no banco...");
  const referenced = new Set<string>();

  // thumbnail_url
  const { data: thumbs, error: thumbErr } = await supabase
    .from("telegram_indexed_stls")
    .select("thumbnail_url")
    .not("thumbnail_url", "is", null);

  if (thumbErr) throw new Error(`Erro ao buscar thumbnails: ${thumbErr.message}`);

  for (const row of thumbs ?? []) {
    if (row.thumbnail_url) {
      const path = row.thumbnail_url.split("/portfolio/")[1];
      if (path) referenced.add(path);
    }
  }

  // photos array — paginado pois pode ser grande
  let photosOffset = 0;
  while (true) {
    const { data: rows, error: photosErr } = await supabase
      .from("telegram_indexed_stls")
      .select("photos")
      .not("photos", "is", null)
      .range(photosOffset, photosOffset + 999);

    if (photosErr) throw new Error(`Erro ao buscar photos: ${photosErr.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      for (const url of row.photos ?? []) {
        const path = url.split("/portfolio/")[1];
        if (path) referenced.add(path);
      }
    }

    photosOffset += rows.length;
    if (rows.length < 1000) break;
  }

  console.log(`  Fotos referenciadas: ${referenced.size}`);

  // Órfãs = no storage mas não referenciadas
  return allFiles.filter((f) => !referenced.has(f));
}

async function deleteInBatches(
  supabase: ReturnType<typeof createClient>,
  paths: string[],
  dryRun: boolean
): Promise<void> {
  const total = paths.length;
  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);

    if (dryRun) {
      console.log(`  [DRY-RUN] Deletaria ${batch.length} arquivos (ex: ${batch[0]})`);
      deleted += batch.length;
    } else {
      const { error } = await supabase.storage.from(BUCKET).remove(batch);

      if (error) {
        console.error(`  ❌ Erro no batch ${i / BATCH_SIZE + 1}: ${error.message}`);
        errors += batch.length;
      } else {
        deleted += batch.length;
      }
    }

    const pct = Math.round((deleted + errors) / total * 100);
    process.stdout.write(`\r  Progresso: ${deleted + errors}/${total} (${pct}%) | ✅ ${deleted} deletados | ❌ ${errors} erros`);
  }

  console.log("\n");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  console.log("🧹 Limpeza de fotos órfãs do Supabase Storage");
  console.log(`   Bucket: ${BUCKET}`);
  if (dryRun) console.log("   Modo: DRY-RUN (nenhum arquivo será deletado)\n");
  else console.log("   Modo: REAL — arquivos serão deletados permanentemente\n");

  console.log("1. Identificando arquivos órfãos...");
  const orphanPaths = await fetchOrphanPathsViaSQL(supabase);

  if (orphanPaths.length === 0) {
    console.log("✅ Nenhum arquivo órfão encontrado. Storage está limpo!");
    return;
  }

  // Estimar tamanho (não disponível via list, mas temos a média de ~116 KB/jpg)
  const estimatedMB = Math.round(orphanPaths.length * 116 / 1024);
  console.log(`\n2. Encontrados ${orphanPaths.length} arquivos órfãos (~${estimatedMB} MB estimados)\n`);

  if (!dryRun) {
    console.log("⚠️  Esta operação é IRREVERSÍVEL.");
    console.log("   Para testar antes, use: npm run cleanup:orphans -- --dry-run\n");
    // Aguarda 3s para dar chance de cancelar com Ctrl+C
    await new Promise((res) => setTimeout(res, 3000));
  }

  console.log(`3. ${dryRun ? "Simulando deleção" : "Deletando"} em batches de ${BATCH_SIZE}...`);
  await deleteInBatches(supabase, orphanPaths, dryRun);

  if (dryRun) {
    console.log(`✅ Dry-run concluído. ${orphanPaths.length} arquivos seriam deletados.`);
  } else {
    console.log(`✅ Limpeza concluída! ${orphanPaths.length} arquivos removidos.`);
    console.log("   O storage deve voltar para ~237 MB (dentro do free tier de 1 GB).");
  }
}

main().catch((err) => {
  console.error("💥 Erro fatal:", err.message);
  process.exit(1);
});
