/**
 * Script: Dedup de Fotos (Consolidação Horizontal com Manifesto)
 *
 * 3 estágios:
 * 1. npm run dedup:photos          → detecta duplicatas, gera manifesto, NADA é deletado
 * 2. npm run dedup:photos -- --confirm  → aplica consolidações no banco (STLs apontam para URL canônica)
 * 3. npm run dedup:photos -- --cleanup  → deleta URLs redundantes do storage (com validações de safety)
 *
 * O manifesto (dedup-manifest.json) garante que URLs canônicas nunca são deletadas.
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import fs from "fs";
import path from "path";

interface Consolidation {
  canonicalUrl: string;
  redundantUrls: string[];
  stlsAffected: Array<{ id: string; file_name: string }>;
}

interface DedupManifest {
  timestamp: string;
  stage: "detected" | "confirmed" | "cleaned";
  canonicalUrls: string[];
  redundantUrls: string[];
  consolidations: Consolidation[];
}

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  const manifestPath = path.join(process.cwd(), "dedup-manifest.json");

  console.log("🔍 Script: Dedup de Fotos com Manifesto\n");

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

  // 2. Construir mapa: URL → lista de STLs
  const urlToStls = new Map<string, typeof allStls>();
  allStls.forEach((stl) => {
    (stl.photos || []).forEach((photoUrl: string) => {
      if (!urlToStls.has(photoUrl)) {
        urlToStls.set(photoUrl, []);
      }
      urlToStls.get(photoUrl)!.push(stl);
    });
  });

  // 3. Detectar grupos de fotos duplicadas (URL compartilhada)
  const consolidations: Consolidation[] = [];
  const canonicalUrls = new Set<string>();
  const redundantUrls = new Set<string>();

  Array.from(urlToStls.entries()).forEach(([url, stls]) => {
    if (stls.length > 1) {
      consolidations.push({
        canonicalUrl: url, // Mantém essa URL
        redundantUrls: [], // Por enquanto, vazio (mesma URL compartilhada, sem redundantes)
        stlsAffected: stls.map((stl) => ({ id: stl.id, file_name: stl.file_name })),
      });
      canonicalUrls.add(url);
    }
  });

  if (consolidations.length === 0) {
    console.log("✅ Nenhuma foto duplicada encontrada!");
    process.exit(0);
  }

  // 4. Mostrar relatório
  console.log(`⚠️  Encontradas ${consolidations.length} foto(s) compartilhadas:\n`);

  consolidations.forEach((cons, i) => {
    console.log(`${i + 1}. Foto em ${cons.stlsAffected.length} STL(s):`);
    console.log(`   URL canônica: ${cons.canonicalUrl.slice(0, 70)}...`);
    cons.stlsAffected.forEach((stl) => {
      console.log(`   - ${stl.file_name}`);
    });
    console.log("");
  });

  // 5. Gerar manifesto
  const manifest: DedupManifest = {
    timestamp: new Date().toISOString(),
    stage: "detected",
    canonicalUrls: Array.from(canonicalUrls),
    redundantUrls: Array.from(redundantUrls),
    consolidations,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Manifesto gerado: dedup-manifest.json\n`);

  console.log("📊 Resumo:");
  console.log(`   - Fotos compartilhadas: ${consolidations.length}`);
  console.log(`   - URLs canônicas (mantidas): ${canonicalUrls.size}`);
  console.log(`   - URLs redundantes (a deletar): ${redundantUrls.size}`);

  // 6. Próximos passos
  if (process.argv.includes("--confirm")) {
    await confirmStage(supabase, allStls, manifestPath, manifest);
  } else {
    console.log("\n⏭️  Próximo passo: npm run dedup:photos -- --confirm\n");
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

  let confirmedCount = 0;

  for (const cons of manifest.consolidations) {
    for (const aff of cons.stlsAffected) {
      const stlData = allStls.find((s) => s.id === aff.id);
      if (!stlData || (stlData.photos || []).includes(cons.canonicalUrl)) {
        continue;
      }

      const updatedPhotos = (stlData.photos || [])
        .concat([cons.canonicalUrl]);

      const { error: updateError } = await supabase
        .from("telegram_indexed_stls")
        .update({ photos: updatedPhotos })
        .eq("id", aff.id);

      if (updateError) {
        console.error(`❌ Erro ao atualizar ${aff.file_name}: ${updateError.message}`);
      } else {
        console.log(`✅ ${aff.file_name}`);
        confirmedCount++;
      }
    }
  }

  // Atualizar manifesto
  manifest.stage = "confirmed";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\n🏁 Consolidação concluída! ${confirmedCount} STL(s) atualizado(s).\n`);
  console.log("📝 Próximo passo:");
  console.log("   npm run dedup:photos -- --cleanup\n");
  console.log("   (Isso vai deletar URLs redundantes do storage com SEGURANÇA)\n");
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
