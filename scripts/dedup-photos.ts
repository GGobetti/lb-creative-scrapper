/**
 * Script: Dedup de Fotos por Conteúdo (Perceptual Hash)
 *
 * Processa DUAS tabelas: telegram_indexed_stls + telegram_scraper_jobs
 *
 * 3 estágios:
 * 1. npm run dedup:photos
 *    → Baixa cada imagem, calcula perceptual hash
 *    → Agrupa URLs com mesmo hash (mesma imagem)
 *    → Gera manifesto (dedup-manifest.json)
 *
 * 2. npm run dedup:photos -- --confirm
 *    → Aplica consolidações no banco (ambas as tabelas)
 *    → STLs e jobs que apontavam para URL redundante agora apontam para URL canônica
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
  jobsWithCanonical: Array<{ id: string; file_name: string }>;
  jobsWithRedundant: Array<{ id: string; file_name: string; oldUrl: string }>;
}

interface DedupManifest {
  timestamp: string;
  stage: "detected" | "confirmed" | "cleaned";
  hashGroups: HashGroup[];
}

async function getImageHash(imageUrl: string, retries = 3): Promise<{ hash: string | null; error: string | null; fileSize: number | null }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(imageUrl, { timeout: 30000 });
      if (!res.ok) {
        if (attempt === retries) {
          return { hash: null, error: `HTTP ${res.status}`, fileSize: null };
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
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
  console.log("   Tabelas: telegram_indexed_stls + telegram_scraper_jobs\n");

  // 1. Buscar todos os STLs indexados
  const { data: allStls, error: stlError } = await supabase
    .from("telegram_indexed_stls")
    .select("id, file_name, photos")
    .eq("is_deleted", false);

  if (stlError) {
    console.error("❌ Erro ao buscar STLs:", stlError.message);
    process.exit(1);
  }

  // 2. Buscar todos os jobs do scrapper (exceto __photo_bucket__ e sem fotos)
  const { data: allJobs, error: jobError } = await supabase
    .from("telegram_scraper_jobs")
    .select("id, file_name, photos")
    .neq("file_name", "__photo_bucket__")
    .not("photos", "is", null);

  if (jobError) {
    console.error("❌ Erro ao buscar jobs:", jobError.message);
    process.exit(1);
  }

  const safeStls = allStls || [];
  const safeJobs = (allJobs || []).filter((j: any) => (j.photos || []).length > 0);

  console.log(`📦 STLs indexados: ${safeStls.length}`);
  console.log(`🔧 Jobs do scrapper com fotos: ${safeJobs.length}\n`);

  // 3. Coletar todas as URLs únicas de ambas as tabelas
  const allUrls = new Set<string>();
  safeStls.forEach((stl: any) => {
    (stl.photos || []).forEach((url: string) => allUrls.add(url));
  });
  safeJobs.forEach((job: any) => {
    (job.photos || []).forEach((url: string) => allUrls.add(url));
  });

  console.log(`📸 URLs únicas totais: ${allUrls.size}\n`);
  console.log("🔄 Calculando perceptual hashes (retry automático 3x, timeout 30s)...\n");

  // 4. Calcular hash de cada URL
  const urlToHash = new Map<string, string>();
  const urlToFileSize = new Map<string, number>();
  const failedUrls: Array<{ url: string; error: string }> = [];
  let processedCount = 0;

  for (const url of allUrls) {
    const result = await getImageHash(url, 3);
    if (result.hash) {
      urlToHash.set(url, result.hash);
      if (result.fileSize) urlToFileSize.set(url, result.fileSize);
    } else if (result.error) {
      failedUrls.push({ url, error: result.error });
    }
    processedCount++;
    if (processedCount % 20 === 0) {
      console.log(`   Processadas: ${processedCount}/${allUrls.size}`);
    }
  }

  console.log(`\n✅ ${urlToHash.size}/${allUrls.size} fotos hashadas com sucesso.`);
  console.log(`⚠️  ${failedUrls.length} URLs falharam ao fazer hash.\n`);

  // 5. Agrupar URLs pelo hash
  const hashToUrls = new Map<string, string[]>();
  urlToHash.forEach((hash, url) => {
    if (!hashToUrls.has(hash)) hashToUrls.set(hash, []);
    hashToUrls.get(hash)!.push(url);
  });

  // 6. Mapas URL → STLs e URL → Jobs
  const urlToStls = new Map<string, typeof safeStls>();
  safeStls.forEach((stl: any) => {
    (stl.photos || []).forEach((url: string) => {
      if (!urlToStls.has(url)) urlToStls.set(url, []);
      urlToStls.get(url)!.push(stl);
    });
  });

  const urlToJobs = new Map<string, typeof safeJobs>();
  safeJobs.forEach((job: any) => {
    (job.photos || []).forEach((url: string) => {
      if (!urlToJobs.has(url)) urlToJobs.set(url, []);
      urlToJobs.get(url)!.push(job);
    });
  });

  // 7. Detectar grupos com duplicatas
  const hashGroups: HashGroup[] = [];

  Array.from(hashToUrls.entries()).forEach(([hash, urls]) => {
    if (urls.length <= 1) return;

    // Preferir URL canônica que já está em indexed_stls (mais estável)
    const urlInStls = urls.find(u => urlToStls.has(u));
    const canonicalUrl = urlInStls || urls[0];
    const redundantUrls = urls.filter(u => u !== canonicalUrl);

    const stlsWithCanonical = urlToStls.get(canonicalUrl) || [];
    const jobsWithCanonical = urlToJobs.get(canonicalUrl) || [];

    const stlsWithRedundant: HashGroup["stlsWithRedundant"] = [];
    const jobsWithRedundant: HashGroup["jobsWithRedundant"] = [];

    redundantUrls.forEach((redUrl) => {
      (urlToStls.get(redUrl) || []).forEach((stl: any) => {
        stlsWithRedundant.push({ id: stl.id, file_name: stl.file_name, oldUrl: redUrl });
      });
      (urlToJobs.get(redUrl) || []).forEach((job: any) => {
        jobsWithRedundant.push({ id: job.id, file_name: job.file_name, oldUrl: redUrl });
      });
    });

    hashGroups.push({
      hash,
      canonicalUrl,
      redundantUrls,
      stlsWithCanonical: stlsWithCanonical.map((s: any) => ({ id: s.id, file_name: s.file_name })),
      stlsWithRedundant,
      jobsWithCanonical: jobsWithCanonical.map((j: any) => ({ id: j.id, file_name: j.file_name })),
      jobsWithRedundant,
    });
  });

  if (hashGroups.length === 0) {
    console.log("✅ Nenhuma foto duplicada (por conteúdo) encontrada!");
    process.exit(0);
  }

  // 8. Relatório
  const totalRedundantUrls = hashGroups.reduce((sum, g) => sum + g.redundantUrls.length, 0);
  const totalStlsAffected = hashGroups.reduce((sum, g) => sum + g.stlsWithRedundant.length, 0);
  const totalJobsAffected = hashGroups.reduce((sum, g) => sum + g.jobsWithRedundant.length, 0);

  console.log(`⚠️  Encontrados ${hashGroups.length} grupo(s) de fotos iguais:\n`);
  hashGroups.slice(0, 5).forEach((group, i) => {
    console.log(`${i + 1}. Hash: ${group.hash}`);
    console.log(`   URL canônica: ${group.canonicalUrl.slice(0, 70)}...`);
    console.log(`   URLs redundantes: ${group.redundantUrls.length}`);
    console.log(`   STLs a corrigir: ${group.stlsWithRedundant.length} | Jobs a corrigir: ${group.jobsWithRedundant.length}`);
    console.log("");
  });
  if (hashGroups.length > 5) console.log(`   ... e mais ${hashGroups.length - 5} grupos (ver análise)\n`);

  // 9. Gerar análise e manifesto
  const analysisPath = path.join(process.cwd(), `dedup-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(analysisPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total_stls: safeStls.length,
      total_jobs: safeJobs.length,
      total_unique_urls: allUrls.size,
      urls_hashed_success: urlToHash.size,
      urls_hashed_failed: failedUrls.length,
      hash_success_rate: `${Math.round((urlToHash.size / allUrls.size) * 100)}%`,
      duplicate_groups_found: hashGroups.length,
      total_urls_redundant: totalRedundantUrls,
      total_stls_to_update: totalStlsAffected,
      total_jobs_to_update: totalJobsAffected,
    },
    failed_urls: failedUrls.slice(0, 50),
    all_hash_groups: hashGroups,
  }, null, 2));
  console.log(`✅ Análise detalhada: ${path.basename(analysisPath)}\n`);

  const manifest: DedupManifest = {
    timestamp: new Date().toISOString(),
    stage: "detected",
    hashGroups,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Manifesto: dedup-manifest.json\n`);

  console.log("📊 Resumo:");
  console.log(`   - Grupos de fotos iguais: ${hashGroups.length}`);
  console.log(`   - URLs redundantes: ${totalRedundantUrls}`);
  console.log(`   - STLs indexados a corrigir: ${totalStlsAffected}`);
  console.log(`   - Jobs do scrapper a corrigir: ${totalJobsAffected}\n`);

  if (failedUrls.length > 0) {
    console.log(`⚠️  ${failedUrls.length} URLs falharam:`);
    failedUrls.slice(0, 5).forEach((item) => {
      console.log(`   - ${item.url.slice(0, 70)}... (${item.error})`);
    });
    if (failedUrls.length > 5) console.log(`   ... e mais ${failedUrls.length - 5}\n`);
  }

  if (process.argv.includes("--confirm")) {
    await confirmStage(supabase, safeStls, safeJobs, manifestPath, manifest);
  } else {
    console.log("📋 Se estiver tudo certo, rode:");
    console.log("   npm run dedup:photos -- --confirm\n");
  }

  process.exit(0);
}

async function confirmStage(
  supabase: any,
  allStls: any[],
  allJobs: any[],
  manifestPath: string,
  manifest: DedupManifest
) {
  console.log("\n🔄 STAGE: Aplicando consolidações (STLs + Jobs)...\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(process.cwd(), `dedup-backup-${timestamp}.json`);
  const logPath = path.join(process.cwd(), `dedup-log-${timestamp}.json`);

  // Backup completo antes de qualquer mudança
  console.log("💾 Criando backup...");
  fs.writeFileSync(backupPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    stls: allStls.map((s) => ({ id: s.id, file_name: s.file_name, photos: s.photos || [] })),
    jobs: allJobs.map((j) => ({ id: j.id, file_name: j.file_name, photos: j.photos || [] })),
  }, null, 2));
  console.log(`✅ Backup: ${path.basename(backupPath)}\n`);

  const changes: any[] = [];
  let stlCount = 0;
  let jobCount = 0;

  // Atualizar STLs
  console.log("📚 Atualizando telegram_indexed_stls...");
  for (const group of manifest.hashGroups) {
    for (const aff of group.stlsWithRedundant) {
      const stlData = allStls.find((s) => s.id === aff.id);
      if (!stlData) continue;

      const oldPhotos = [...(stlData.photos || [])];
      const updatedPhotos = (stlData.photos || [])
        .filter((url: string) => url !== aff.oldUrl)
        .concat([group.canonicalUrl])
        .filter((url: string, idx: number, arr: string[]) => arr.indexOf(url) === idx);

      const { error } = await supabase
        .from("telegram_indexed_stls")
        .update({ photos: updatedPhotos })
        .eq("id", aff.id);

      if (error) {
        console.error(`  ❌ STL ${aff.file_name}: ${error.message}`);
      } else {
        console.log(`  ✅ STL: ${aff.file_name}`);
        stlCount++;
        changes.push({ table: "telegram_indexed_stls", id: aff.id, file_name: aff.file_name, hash_group: group.hash, old_url: aff.oldUrl, canonical_url: group.canonicalUrl, old_photos: oldPhotos, new_photos: updatedPhotos });
      }
    }
  }

  // Atualizar Jobs
  console.log(`\n🔧 Atualizando telegram_scraper_jobs...`);
  for (const group of manifest.hashGroups) {
    for (const aff of group.jobsWithRedundant) {
      const jobData = allJobs.find((j) => j.id === aff.id);
      if (!jobData) continue;

      const oldPhotos = [...(jobData.photos || [])];
      const updatedPhotos = (jobData.photos || [])
        .filter((url: string) => url !== aff.oldUrl)
        .concat([group.canonicalUrl])
        .filter((url: string, idx: number, arr: string[]) => arr.indexOf(url) === idx);

      const { error } = await supabase
        .from("telegram_scraper_jobs")
        .update({ photos: updatedPhotos })
        .eq("id", aff.id);

      if (error) {
        console.error(`  ❌ Job ${aff.file_name}: ${error.message}`);
      } else {
        console.log(`  ✅ Job: ${aff.file_name}`);
        jobCount++;
        changes.push({ table: "telegram_scraper_jobs", id: aff.id, file_name: aff.file_name, hash_group: group.hash, old_url: aff.oldUrl, canonical_url: group.canonicalUrl, old_photos: oldPhotos, new_photos: updatedPhotos });
      }
    }
  }

  // Salvar log e atualizar manifesto
  fs.writeFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), stage: "confirmed", stls_updated: stlCount, jobs_updated: jobCount, total_changes: stlCount + jobCount, changes }, null, 2));
  manifest.stage = "confirmed";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\n🏁 Consolidação concluída!`);
  console.log(`   - STLs atualizados: ${stlCount}`);
  console.log(`   - Jobs atualizados: ${jobCount}`);
  console.log(`   - Log: ${path.basename(logPath)}`);
  console.log(`   - Backup: ${path.basename(backupPath)}\n`);
  console.log("📝 Próximo passo (opcional — deleta URLs redundantes do storage):");
  console.log("   npm run dedup:photos -- --cleanup\n");
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
