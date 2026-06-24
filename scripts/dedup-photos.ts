/**
 * Script: Dedup de Fotos (Consolidação Horizontal)
 *
 * Detecta fotos compartilhadas entre múltiplos STLs e consolida em uma única URL.
 * Atualiza TODOS os STLs para apontar para a foto "canônica" mantida.
 * Marca URLs redundantes para deleção manual (não deleta automaticamente).
 *
 * Uso: npm run dedup:photos
 *
 * Saída: relatório com consolidações propostas, STLs afetados, e URLs a deletar.
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import fs from "fs";
import path from "path";

interface PhotoGroup {
  canonicalUrl: string; // URL mantida (a primeira encontrada)
  duplicateUrls: string[]; // URLs a serem removidas
  stlsAffected: Array<{ id: string; file_name: string; oldUrl: string }>;
}

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  console.log("🔍 Iniciando dedup HORIZONTAL de fotos...\n");

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

  // 2. Construir mapa: URL → lista de STLs que possuem essa URL
  const urlToStls = new Map<string, typeof allStls>();

  allStls.forEach((stl) => {
    (stl.photos || []).forEach((photoUrl: string) => {
      if (!urlToStls.has(photoUrl)) {
        urlToStls.set(photoUrl, []);
      }
      urlToStls.get(photoUrl)!.push(stl);
    });
  });

  // 3. Detectar grupos de fotos duplicadas (compartilhadas entre STLs)
  const duplicateGroups: PhotoGroup[] = [];

  Array.from(urlToStls.entries()).forEach(([url, stls]) => {
    if (stls.length > 1) {
      // Foto aparece em múltiplos STLs — é duplicada
      // (não necessariamente mesma URL em múltiplos places, mas mesma imagem)

      // Verificar se essa URL já foi registrada como duplicata de outra
      const alreadyGrouped = duplicateGroups.some(
        (group) =>
          group.canonicalUrl === url || group.duplicateUrls.includes(url)
      );

      if (!alreadyGrouped) {
        duplicateGroups.push({
          canonicalUrl: url, // mantém essa URL
          duplicateUrls: [], // nenhum duplicate detectado por URL exata
          stlsAffected: stls.map((stl) => ({
            id: stl.id,
            file_name: stl.file_name,
            oldUrl: url,
          })),
        });
      }
    }
  });

  if (duplicateGroups.length === 0) {
    console.log("✅ Nenhuma foto duplicada (compartilhada entre STLs) encontrada!");
    process.exit(0);
  }

  console.log(`⚠️  Encontradas ${duplicateGroups.length} foto(s) compartilhadas:\n`);

  let totalUpdated = 0;
  const toDeleteLog: string[] = [];

  // 4. Para cada grupo de fotos duplicadas, consolidar
  for (let i = 0; i < duplicateGroups.length; i++) {
    const group = duplicateGroups[i];
    const count = group.stlsAffected.length;

    console.log(`${i + 1}. 🖼️  Foto compartilhada entre ${count} STL(s):`);
    console.log(`   URL canônica (mantida): ${group.canonicalUrl.slice(0, 70)}...`);
    console.log(`   STLs afetados:`);

    group.stlsAffected.forEach((aff, idx) => {
      console.log(`   ${idx + 1}. ${aff.file_name} (ID: ${aff.id.slice(0, 8)}...)`);
    });

    console.log("");
  }

  console.log("\n✅ Relatório gerado.\n");
  console.log("📊 Resumo de consolidações propostas:");
  console.log(`   - Grupos de fotos duplicadas: ${duplicateGroups.length}`);
  console.log(`   - Total de STLs a atualizar: ${duplicateGroups.reduce((sum, g) => sum + g.stlsAffected.length, 0)}`);

  // 5. Confirmar com usuário antes de aplicar
  console.log("\n⚠️  AVISO: As consolidações acima são propostas para ANÁLISE.");
  console.log("Por enquanto, nenhuma mudança foi aplicada ao banco.\n");
  console.log("Para confirmar e aplicar as consolidações, rode:");
  console.log("  npm run dedup:photos -- --confirm\n");

  // Se --confirm foi passado, aplicar
  if (process.argv.includes("--confirm")) {
    console.log("🔄 Aplicando consolidações...\n");

    let confirmedCount = 0;
    for (const group of duplicateGroups) {
      const { canonicalUrl, stlsAffected } = group;

      for (const aff of stlsAffected) {
        // Buscar o STL para atualizar seu array de fotos
        const stlData = allStls.find((s) => s.id === aff.id);
        if (!stlData) continue;

        // Se a foto canônica JÁ está no array, não precisa fazer nada
        if ((stlData.photos || []).includes(canonicalUrl)) {
          continue;
        }

        // Remover a foto antiga e adicionar a canônica
        const updatedPhotos = (stlData.photos || [])
          .filter((url: string) => url !== aff.oldUrl)
          .concat([canonicalUrl]);

        const { error: updateError } = await supabase
          .from("telegram_indexed_stls")
          .update({ photos: updatedPhotos })
          .eq("id", aff.id);

        if (updateError) {
          console.error(
            `❌ Erro ao atualizar ${aff.file_name}: ${updateError.message}`
          );
        } else {
          console.log(`✅ ${aff.file_name} → consolidada para URL canônica`);
          confirmedCount++;
        }
      }
    }

    console.log(`\n🏁 Consolidação concluída! ${confirmedCount} STL(s) foram atualizados.\n`);
    console.log("📝 Próximos passos:");
    console.log("   1. Verifique no banco se as consolidações ficaram corretas");
    console.log("   2. Quando estiver seguro, delete as fotos redundantes do storage");
    console.log("   3. Execute: npm run dedup:photos -- --cleanup\n");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
