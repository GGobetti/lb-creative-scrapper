/**
 * Script: Validar integridade após migração para R2
 *
 * Verifica que nenhuma URL no banco ainda aponta para Supabase Storage.
 * Deve ser executado ANTES de fazer o cleanup do Supabase.
 *
 * Uso: npm run validate:migration
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

async function main() {
  console.log("🔍 Validando integridade da migração R2\n");

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let issues = 0;

  // 1. Verificar thumbnails
  const { data: badThumbnails, error: e1 } = await supabase
    .from("telegram_indexed_stls")
    .select("id, thumbnail_url")
    .like("thumbnail_url", "%supabase.co%");

  if (e1) throw new Error(e1.message);

  if (badThumbnails && badThumbnails.length > 0) {
    console.log(`❌ ${badThumbnails.length} registros ainda têm thumbnail em Supabase:`);
    badThumbnails.slice(0, 5).forEach((r) =>
      console.log(`   - ${r.id.slice(0, 8)}: ${r.thumbnail_url}`)
    );
    issues += badThumbnails.length;
  } else {
    console.log(`✅ Todos os thumbnails apontam para R2`);
  }

  // 2. Verificar arrays de fotos
  const { data: allStls, error: e2 } = await supabase
    .from("telegram_indexed_stls")
    .select("id, photos")
    .not("photos", "is", null);

  if (e2) throw new Error(e2.message);

  let badArrayCount = 0;
  for (const stl of allStls || []) {
    const hasBad = (stl.photos || []).some((u: string) => u?.includes("supabase.co"));
    if (hasBad) badArrayCount++;
  }

  if (badArrayCount > 0) {
    console.log(`❌ ${badArrayCount} registros têm fotos no array ainda em Supabase`);
    issues += badArrayCount;
  } else {
    console.log(`✅ Todos os arrays de fotos apontam para R2`);
  }

  // 3. Verificar Supabase Storage (ignorar subpastas como manual/ — contêm STLs manuais)
  const { data: remaining } = await supabase.storage
    .from("portfolio")
    .list("telegram", { limit: 100 });

  const photoFiles = (remaining || []).filter(
    (f) => !f.id && f.name !== "manual" // pastas não têm id; "manual" é STLs manuais
      || (f.name?.startsWith("photo_"))
  );

  if (photoFiles.length > 0) {
    console.log(`\n⚠️  Ainda há ${photoFiles.length} fotos em Supabase Storage (portfolio/telegram/)`);
    console.log(`   Execute npm run cleanup:supabase-photos para remover`);
  } else {
    console.log(`✅ Supabase Storage (portfolio/telegram/) limpo de fotos`);
  }

  // Resultado
  console.log("\n" + "─".repeat(50));
  if (issues === 0) {
    console.log("✅ MIGRAÇÃO VÁLIDA — pode fazer cleanup do Supabase com segurança.");
  } else {
    console.log(`❌ ${issues} problemas encontrados. NÃO faça cleanup ainda.`);
    console.log(`   Execute: npm run update-photo-urls`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("💥 Erro:", err.message);
  process.exit(1);
});
