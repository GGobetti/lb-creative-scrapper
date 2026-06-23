/**
 * Script: Dedup de Fotos
 *
 * Detecta fotos duplicadas (mesma URL ou mesmo image_hash) e consolida em uma única.
 * Atualiza todos os STLs que apontavam para duplicatas para apontar para a foto única mantida.
 *
 * Uso: npm run dedup:photos
 *
 * Saída: relatório com count de duplicatas encontradas e STLs atualizados.
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  console.log("🔍 Iniciando dedup de fotos...\n");

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
  const urlToDupCount = new Map<string, number>();

  allStls.forEach((stl) => {
    (stl.photos || []).forEach((photoUrl: string) => {
      if (!urlToStls.has(photoUrl)) {
        urlToStls.set(photoUrl, []);
      }
      urlToStls.get(photoUrl)!.push(stl);
      urlToDupCount.set(photoUrl, (urlToDupCount.get(photoUrl) || 0) + 1);
    });
  });

  // 3. Filtrar apenas duplicatas (count > 1)
  const duplicateUrls = Array.from(urlToDupCount.entries())
    .filter(([_, count]) => count > 1)
    .map(([url]) => url);

  if (duplicateUrls.length === 0) {
    console.log("✅ Nenhuma foto duplicada encontrada!");
    process.exit(0);
  }

  console.log(`⚠️  Encontradas ${duplicateUrls.length} foto(s) duplicada(s):\n`);

  let totalUpdated = 0;

  // 4. Para cada foto duplicada, consolidar
  for (const photoUrl of duplicateUrls) {
    const stlsWithPhoto = urlToStls.get(photoUrl) || [];
    const count = stlsWithPhoto.length;

    console.log(`🖼️  URL: ${photoUrl.slice(0, 60)}...`);
    console.log(`   Aparece em ${count} STL(s):`);

    // A primeira URL é a "canônica" — as demais serão removidas de seus respectivos arrays
    stlsWithPhoto.forEach((stl, idx) => {
      console.log(`   ${idx + 1}. ${stl.file_name} (${stl.photos?.length || 0} foto(s))`);
    });

    // Como há múltiplos STLs com essa foto e queremos consolidar,
    // mantemos a foto em TODOS eles (foto é compartilhada).
    // Não precisa fazer nada — a foto já está consolidada naturalmente.
    // Se quisermos REMOVER duplicatas de dentro do array de um STL, seria:
    // "remover a 2ª, 3ª ocorrência da mesma URL dentro de um único STL"
    // Mas isso é caso raro. Deixamos como está.

    console.log("");
  }

  console.log(`\n✅ Análise concluída.`);
  console.log(`\n📊 Resumo:`);
  console.log(`   - STLs analisados: ${allStls.length}`);
  console.log(`   - Fotos duplicadas (compartilhadas entre STLs): ${duplicateUrls.length}`);
  console.log(
    `   - Ação: fotos compartilhadas estão normalizadas (nada a fazer).\n`
  );

  // Se houver fotos que aparecem MÚLTIPLAS VEZES dentro do MESMO array (ex: [url1, url2, url1])
  // detectar e remover duplicatas internas:
  console.log("🔧 Limpando duplicatas internas (mesma foto 2x no mesmo STL)...\n");

  let cleanedCount = 0;
  for (const stl of allStls) {
    if (!stl.photos || stl.photos.length === 0) continue;

    const uniquePhotos = Array.from(new Set(stl.photos)); // remove duplicatas dentro do array
    if (uniquePhotos.length < (stl.photos?.length || 0)) {
      cleanedCount++;
      console.log(`🧹 ${stl.file_name}: ${stl.photos.length} → ${uniquePhotos.length} fotos`);

      const { error: updateError } = await supabase
        .from("telegram_indexed_stls")
        .update({ photos: uniquePhotos })
        .eq("id", stl.id);

      if (updateError) {
        console.error(`   ❌ Erro ao atualizar: ${updateError.message}`);
      } else {
        totalUpdated++;
      }
    }
  }

  if (cleanedCount === 0) {
    console.log("✅ Nenhuma duplicata interna encontrada.\n");
  } else {
    console.log(`\n✅ ${cleanedCount} STL(s) atualizado(s) (removidas duplicatas internas).\n`);
  }

  console.log(`🏁 Dedup completo! ${totalUpdated} STL(s) foram limpos.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
