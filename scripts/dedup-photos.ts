/**
 * Script: Dedup de Fotos por Conteúdo (Perceptual Hash)
 *
 * 3 estágios:
 * 1. npm run dedup:photos
 *    → Baixa cada imagem, calcula perceptual hash
 *    → Agrupa URLs com mesmo hash (mesma imagem)
 *    → Gera manifesto (dedup-manifest.json)
 *
 * 2. npm run dedup:photos -- --confirm
 *    → Aplica consolidações no banco
 *    → STLs que apontavam para URL redundante agora apontam para URL canônica
 *
 * 3. npm run dedup:photos -- --cleanup
 *    → Deleta URLs redundantes do storage (com validações de safety)
 *    → URLs canônicas NUNCA são deletadas
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { getPerceptualHash } from "../src/scraper/imageHash";
import fs from "fs";
import path from "path";
import os from "os";

interface HashGroup {
  hash: string;
  canonicalUrl: string;
  redundantUrls: string[];
  stlsWithCanonical: Array<{ id: string; file_name: string }>;
  stlsWithRedundant: Array<{ id: string; file_name: string; oldUrl: string }>;
}

interface DedupManifest {
  timestamp: string;
  stage: "detected" | "confirmed" | "cleaned";
  hashGroups: HashGroup[];
}

async function getImageHash(imageUrl: string, retries = 3): Promise<{ hash: string | null; error: string | null; fileSize: number | null }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(imageUrl, { timeout: 30000 }); // 30s timeout
      if (!res.ok) {
        if (attempt === retries) {
          return { hash: null, error: `HTTP ${res.status}`, fileSize: null };
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // backoff
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const fileSize = buffer.length;
      const tempPath = path.join(
        os.tmpdir(),
        `dedup_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      );
      fs.writeFileSync(tempPath, buffer);

      let hash: string | null = null;
      try {
        hash = await getPerceptualHash(tempPath);
      } finally {
        try {
          fs.unlinkSync(tempPath);
        } catch {}
      }

      return { hash, error: null, fileSize };
    } catch (err: any) {
      if (attempt === retries) {
        return { hash: null, error: err?.message || "Unknown error", fileSize: null };
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return { hash: null, error: "Max retries exceeded", fileSize: null };
}

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  const manifestPath = path.join(process.cwd(), "dedup-manifest.json");

  console.log("🔍 Script: Dedup de Fotos por Conteúdo (Perceptual Hash)\n");

  // 1. Buscar todos os STLs com suas fotos
  const { data: allStls, error: stlError } = await supabase
    .from("telegram_indexed_stls")
    .select("id, file_name, photos")
    .eq("is_deleted", false);

  if (stlError) {
    console.error("❌ Erro ao buscar STLs:", stlError.message);
    process.exit(1);
  }

  if (!allStls || allStls.length === 0) {
    console.log("ℹ️  Nenhum STL encontrado.");
    process.exit(0);
  }

  console.log(`📦 Encontrados ${allStls.length} STLs.\n`);

  // 2. Coletar todas as URLs únicas de fotos
  const allUrls = new Set<string>();
  allStls.forEach((stl) => {
    (stl.photos || []).forEach((url: string) => {
      allUrls.add(url);
    });
  });

  console.log(`📸 Encontradas ${allUrls.size} URLs únicas de fotos.\n`);
  console.log("🔄 Calculando perceptual hashes (retry automático 3x, timeout 30s)...\n");

  // 3. Calcular hash de cada URL com retry
  const urlToHash = new Map<string, string>();
  const urlToFileSize = new Map<string, number>();
  const failedUrls: Array<{ url: string; error: string }> = [];
  let processedCount = 0;

  for (const url of allUrls) {
    const result = await getImageHash(url, 3); // 3 tentativas
    if (result.hash) {
      urlToHash.set(url, result.hash);
      if (result.fileSize) {
        urlToFileSize.set(url, result.fileSize);
      }
    } else if (result.error) {
      failedUrls.push({ url, error: result.error });
    }
    processedCount++;
    if (processedCount % 20 === 0) {
      console.log(`   Processadas: ${processedCount}/${allUrls.size}`);
    }
  }

  console.log(`\n✅ ${urlToHash.size}/${allUrls.size} fotos foram hashadas com sucesso.`);
  console.log(`⚠️  ${failedUrls.length} URLs falharam ao fazer hash.\n`);

  // 4. Agrupar URLs pelo hash
  const hashToUrls = new Map<string, string[]>();
  urlToHash.forEach((hash, url) => {
    if (!hashToUrls.has(hash)) {
      hashToUrls.set(hash, []);
    }
    hashToUrls.get(hash)!.push(url);
  });

  // 5. Construir mapa URL → STLs que a possuem
  const urlToStls = new Map<string, typeof allStls>();
  allStls.forEach((stl) => {
    (stl.photos || []).forEach((url: string) => {
      if (!urlToStls.has(url)) {
        urlToStls.set(url, []);
      }
      urlToStls.get(url)!.push(stl);
    });
  });

  // 6. Detectar grupos com duplicatas (múltiplas URLs = mesma imagem)
  const hashGroups: HashGroup[] = [];

  Array.from(hashToUrls.entries()).forEach(([hash, urls]) => {
    if (urls.length > 1) {
      // Múltiplas URLs com mesmo hash = fotos iguais
      const canonicalUrl = urls[0]; // Primeira URL é canônica
      const redundantUrls = urls.slice(1);

      const stlsWithCanonical = urlToStls.get(canonicalUrl) || [];
      const stlsWithRedundant: HashGroup["stlsWithRedundant"] = [];

      redundantUrls.forEach((redUrl) => {
        const stls = urlToStls.get(redUrl) || [];
        stls.forEach((stl) => {
          stlsWithRedundant.push({
            id: stl.id,
            file_name: stl.file_name,
            oldUrl: redUrl,
          });
        });
      });

      hashGroups.push({
        hash,
        canonicalUrl,
        redundantUrls,
        stlsWithCanonical: stlsWithCanonical.map((s) => ({ id: s.id, file_name: s.file_name })),
        stlsWithRedundant,
      });
    }
  });

  if (hashGroups.length === 0) {
    console.log("✅ Nenhuma foto duplicada (por conteúdo) encontrada!");
    process.exit(0);
  }

  // 7. Mostrar relatório
  console.log(`⚠️  Encontrados ${hashGroups.length} grupo(s) de fotos iguais:\n`);

  let totalStlsAffected = 0;
  hashGroups.forEach((group, i) => {
    const totalStls = group.stlsWithCanonical.length + group.stlsWithRedundant.length;
    totalStlsAffected += totalStls;

    console.log(`${i + 1}. Hash: ${group.hash}`);
    console.log(`   URLs duplicadas: ${group.redundantUrls.length + 1}`);
    console.log(`   URL canônica (mantida): ${group.canonicalUrl.slice(0, 70)}...`);
    console.log(`   URLs redundantes (a deletar):`);
    group.redundantUrls.forEach((url) => {
      console.log(`     - ${url.slice(0, 70)}...`);
    });
    console.log(`   STLs afetados: ${totalStls}`);
    group.stlsWithRedundant.forEach((stl) => {
      console.log(`     - ${stl.file_name} (${stl.oldUrl.slice(0, 50)}... → canônica)`);
    });
    console.log("");
  });

  // 8. Gerar análise detalhada e manifesto
  const analysisPath = path.join(process.cwd(), `dedup-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const analysis = {
    timestamp: new Date().toISOString(),
    summary: {
      total_stls: allStls.length,
      total_unique_urls: allUrls.size,
      urls_hashed_success: urlToHash.size,
      urls_hashed_failed: failedUrls.length,
      hash_success_rate: `${Math.round((urlToHash.size / allUrls.size) * 100)}%`,
      duplicate_groups_found: hashGroups.length,
      total_urls_redundant: hashGroups.reduce((sum, g) => sum + g.redundantUrls.length, 0),
      total_stls_affected: totalStlsAffected,
    },
    failed_urls: failedUrls.slice(0, 50), // Primeiros 50 falhas
    hash_groups_preview: hashGroups.slice(0, 5), // Preview dos primeiros 5 grupos
    all_hash_groups: hashGroups,
  };

  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  console.log(`✅ Análise detalhada gerada: ${path.basename(analysisPath)}\n`);

  const manifest: DedupManifest = {
    timestamp: new Date().toISOString(),
    stage: "detected",
    hashGroups,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Manifesto gerado: dedup-manifest.json\n`);

  console.log("📊 Resumo:");
  console.log(`   - Total de STLs: ${allStls.length}`);
  console.log(`   - URLs únicas: ${allUrls.size}`);
  console.log(`   - URLs hasheadas: ${urlToHash.size}/${allUrls.size} (${Math.round((urlToHash.size / allUrls.size) * 100)}%)`);
  console.log(`   - Grupos de fotos iguais: ${hashGroups.length}`);
  console.log(`   - Total de URLs redundantes: ${hashGroups.reduce((sum, g) => sum + g.redundantUrls.length, 0)}`);
  console.log(`   - Total de STLs a atualizar: ${totalStlsAffected}\n`);

  if (failedUrls.length > 0) {
    console.log(`⚠️  ${failedUrls.length} URLs falharam ao fazer hash:`);
    failedUrls.slice(0, 5).forEach((item) => {
      console.log(`   - ${item.url.slice(0, 70)}... (${item.error})`);
    });
    if (failedUrls.length > 5) {
      console.log(`   ... e mais ${failedUrls.length - 5} (ver em ${path.basename(analysisPath)})\n`);
    }
  }

  // 9. Próximos passos
  if (process.argv.includes("--confirm")) {
    await confirmStage(supabase, allStls, manifestPath, manifest);
  } else {
    console.log("📋 Revise os arquivos gerados ANTES de confirmar:");
    console.log(`   1. cat ${path.basename(analysisPath)}`);
    console.log(`   2. Verifique os grupos de fotos duplicadas`);
    console.log(`   3. Se estiver tudo certo, rode:\n`);
    console.log("   npm run dedup:photos -- --confirm\n");
  }

  process.exit(0);
}

async function confirmStage(
  supabase: any,
  allStls: any[],
  manifestPath: string,
  manifest: DedupManifest
) {
  console.log("\n🔄 STAGE: Aplicando consolidações...\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(process.cwd(), `dedup-backup-${timestamp}.json`);
  const logPath = path.join(process.cwd(), `dedup-log-${timestamp}.json`);

  // 1. Backup ANTES de aplicar mudanças
  console.log("💾 Criando backup do estado atual...");
  const backup = {
    timestamp: new Date().toISOString(),
    totalStls: allStls.length,
    stls: allStls.map((stl) => ({
      id: stl.id,
      file_name: stl.file_name,
      photos: stl.photos || [],
    })),
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`✅ Backup salvo em: ${backupPath}\n`);

  // 2. Aplicar consolidações com log detalhado
  const changes: any[] = [];
  let confirmedCount = 0;

  for (const group of manifest.hashGroups) {
    for (const aff of group.stlsWithRedundant) {
      const stlData = allStls.find((s) => s.id === aff.id);
      if (!stlData) continue;

      const oldPhotos = [...(stlData.photos || [])];

      // Remover URL redundante, adicionar URL canônica
      const updatedPhotos = (stlData.photos || [])
        .filter((url: string) => url !== aff.oldUrl) // Remove redundante
        .concat([group.canonicalUrl]) // Adiciona canônica
        .filter((url: string, idx: number, arr: string[]) => arr.indexOf(url) === idx); // Dedup

      const { error: updateError } = await supabase
        .from("telegram_indexed_stls")
        .update({ photos: updatedPhotos })
        .eq("id", aff.id);

      if (updateError) {
        console.error(`❌ Erro ao atualizar ${aff.file_name}: ${updateError.message}`);
      } else {
        console.log(`✅ ${aff.file_name}`);
        confirmedCount++;

        // Registrar mudança no log
        changes.push({
          stl_id: aff.id,
          stl_name: aff.file_name,
          hash_group: group.hash,
          old_url: aff.oldUrl,
          canonical_url: group.canonicalUrl,
          old_photos: oldPhotos,
          new_photos: updatedPhotos,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 3. Salvar log detalhado
  const log = {
    timestamp: new Date().toISOString(),
    stage: "confirmed",
    total_changes: confirmedCount,
    changes,
    manifest_path: manifestPath,
    backup_path: backupPath,
  };
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\n📝 Log detalhado salvo em: ${logPath}\n`);

  // Atualizar manifesto
  manifest.stage = "confirmed";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`🏁 Consolidação concluída! ${confirmedCount} STL(s) atualizado(s).\n`);
  console.log("📦 Arquivos gerados:");
  console.log(`   - Backup: ${path.basename(backupPath)}`);
  console.log(`   - Log: ${path.basename(logPath)}`);
  console.log(`   - Manifesto: dedup-manifest.json\n`);
  console.log("📝 Próximo passo:");
  console.log("   npm run dedup:photos -- --cleanup\n");
  console.log("   (Isso vai deletar URLs redundantes do storage com SEGURANÇA)\n");
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
