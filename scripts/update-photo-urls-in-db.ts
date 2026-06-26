/**
 * Script: Atualizar URLs de fotos/avatars no banco: Supabase → R2
 *
 * Substitui todas as URLs que apontam para Supabase Storage pelas
 * equivalentes no R2 (mesmo nome de arquivo, prefixo photos/).
 *
 * Uso: npm run update-photo-urls [--dry-run]
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { getR2Url } from "../src/lib/r2-photos";

const DRY_RUN = process.argv.includes("--dry-run");

function supabaseUrlToR2(url: string): string {
  const filename = url.split("/").pop()!;
  return getR2Url(`photos/${filename}`);
}

async function main() {
  console.log("🔄 Atualizando URLs no banco: Supabase → R2");
  if (DRY_RUN) console.log("   [DRY-RUN]\n");

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Buscar todos os STLs com paginação (Supabase limita a 1000 por request)
  const stls: Array<{ id: string; thumbnail_url: string | null; photos: string[] | null }> = [];
  let page = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("telegram_indexed_stls")
      .select("id, thumbnail_url, photos")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    stls.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  let thumbnailUpdated = 0;
  let photosUpdated = 0;
  let skipped = 0;

  console.log(`\nProcessando ${stls.length} registros...\n`);

  for (const stl of stls || []) {
    const newThumbnail =
      stl.thumbnail_url?.includes("supabase.co")
        ? supabaseUrlToR2(stl.thumbnail_url)
        : stl.thumbnail_url;

    const newPhotos = (stl.photos || []).map((u: string) =>
      u?.includes("supabase.co") ? supabaseUrlToR2(u) : u
    );

    const thumbnailChanged = newThumbnail !== stl.thumbnail_url;
    const photosChanged = JSON.stringify(newPhotos) !== JSON.stringify(stl.photos || []);

    if (!thumbnailChanged && !photosChanged) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      if (thumbnailChanged) {
        console.log(`  [DRY] thumbnail: ${stl.thumbnail_url?.split("/").pop()}`);
        console.log(`               → ${newThumbnail?.split("/").pop()}`);
      }
      if (photosChanged) {
        const changed = newPhotos.filter((u: string, i: number) => u !== (stl.photos || [])[i]);
        console.log(`  [DRY] ${changed.length} fotos no array`);
      }
      if (thumbnailChanged) thumbnailUpdated++;
      if (photosChanged) photosUpdated++;
      continue;
    }

    const update: Record<string, unknown> = {};
    if (thumbnailChanged) update.thumbnail_url = newThumbnail;
    if (photosChanged) update.photos = newPhotos;

    const { error: upErr } = await supabase
      .from("telegram_indexed_stls")
      .update(update)
      .eq("id", stl.id);

    if (upErr) {
      console.error(`  ❌ ${stl.id.slice(0, 8)}: ${upErr.message}`);
    } else {
      if (thumbnailChanged) thumbnailUpdated++;
      if (photosChanged) photosUpdated++;
    }
  }

  console.log(`\n✅ Concluído!`);
  console.log(`   Thumbnails atualizados: ${thumbnailUpdated}`);
  console.log(`   Arrays de fotos:        ${photosUpdated}`);
  console.log(`   Sem alteração:          ${skipped}`);
  if (DRY_RUN) console.log(`\n   Execute sem --dry-run para aplicar.`);
}

main().catch((err) => {
  console.error("💥 Erro:", err.message);
  process.exit(1);
});
