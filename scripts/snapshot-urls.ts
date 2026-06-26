/**
 * Script: Snapshot de todas as URLs de fotos antes da migração.
 * Salva em backups/migration-2026-06-25/urls-snapshot.json
 * para permitir rollback caso algo dê errado.
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SNAPSHOT_PATH = "backups/migration-2026-06-25/urls-snapshot.json";

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log("📸 Criando snapshot de URLs pré-migração...\n");

  // Buscar todos os STLs com thumbnail_url ou photos
  const { data, error } = await supabase
    .from("telegram_indexed_stls")
    .select("id, thumbnail_url, photos")
    .not("thumbnail_url", "is", null);

  if (error) throw new Error(`Erro ao buscar: ${error.message}`);

  const snapshot = {
    created_at: new Date().toISOString(),
    total: data?.length || 0,
    records: data?.map((r) => ({
      id: r.id,
      thumbnail_url: r.thumbnail_url,
      photos: r.photos || [],
    })),
  };

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));

  const withPhotos = data?.filter((r) => r.photos && r.photos.length > 0).length || 0;
  const totalPhotoUrls = data?.reduce((acc, r) => acc + (r.photos?.length || 0), 0) || 0;

  console.log(`✅ Snapshot criado em: ${SNAPSHOT_PATH}`);
  console.log(`   STLs com thumbnail: ${snapshot.total}`);
  console.log(`   STLs com fotos:     ${withPhotos}`);
  console.log(`   Total URLs fotos:   ${totalPhotoUrls}`);
}

main().catch((err) => {
  console.error("💥 Erro:", err.message);
  process.exit(1);
});
