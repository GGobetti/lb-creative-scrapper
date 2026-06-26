/**
 * Fix: Re-upload Pokémon photos para R2 preservando o caminho completo.
 *
 * Problema: migração anterior usou só o filename (1-1.png) como key no R2,
 * sobrescrevendo fotos de Pokémon diferentes. Agora cada foto vai para
 * local-upload/pokemon/<folder>/<file> preservando unicidade.
 *
 * Uso: tsx scripts/fix-pokemon-photos.ts [--dry-run]
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DRY_RUN = process.argv.includes("--dry-run");

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

function r2ProxyUrl(key: string) {
  return `/api/photo?key=${encodeURIComponent(key)}`;
}

async function uploadToR2(key: string, buffer: Buffer, contentType: string) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: contentType,
  }));
}

async function main() {
  console.log("🔧 Corrigindo fotos Pokémon no R2...");
  if (DRY_RUN) console.log("   [DRY-RUN]\n");

  // 1. Listar todas as pastas Pokémon
  const { data: folders } = await sb.storage
    .from("portfolio")
    .list("portfolio/local-upload/pokemon", { limit: 200 });

  console.log(`Pastas encontradas: ${folders?.length || 0}\n`);

  let uploaded = 0;
  let dbUpdated = 0;
  let errors = 0;

  for (const folder of folders || []) {
    const folderName = folder.name; // ex: "0053-persian"
    const { data: files } = await sb.storage
      .from("portfolio")
      .list(`portfolio/local-upload/pokemon/${folderName}`, { limit: 50 });

    for (const file of files || []) {
      const supabasePath = `portfolio/local-upload/pokemon/${folderName}/${file.name}`;
      const r2Key = `local-upload/pokemon/${folderName}/${file.name}`;
      const oldSupabaseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/portfolio/${supabasePath}`;
      const newProxyUrl = r2ProxyUrl(r2Key);

      console.log(`  ${folderName}/${file.name}`);
      if (DRY_RUN) {
        console.log(`    [DRY] key: ${r2Key}`);
        console.log(`    [DRY] url: ${newProxyUrl}`);
        uploaded++;
        continue;
      }

      try {
        // Download do Supabase
        const { data: blob, error } = await sb.storage
          .from("portfolio")
          .download(supabasePath);

        if (error || !blob) throw new Error(error?.message || "download failed");

        const buffer = Buffer.from(await blob.arrayBuffer());
        const contentType = file.name.endsWith(".png") ? "image/png" : "image/jpeg";

        // Upload para R2 com key completo
        await uploadToR2(r2Key, buffer, contentType);
        uploaded++;
        console.log(`    ✅ R2: ${r2Key}`);
      } catch (e: any) {
        console.error(`    ❌ ${e.message}`);
        errors++;
        continue;
      }

      // Atualizar todas as referências no banco que apontam para esta imagem
      // (URL antiga = supabase URL com caminho completo OU proxy com só filename)
      const oldProxyUrl1 = `/api/photo?key=${encodeURIComponent(file.name)}`; // bug: só filename
      const oldProxyUrl2 = `/api/photo?key=photos%2F${encodeURIComponent(file.name)}`; // outro bug possível

      // Buscar STLs que têm este arquivo como thumbnail
      const { data: stls } = await sb
        .from("telegram_indexed_stls")
        .select("id, thumbnail_url, photos")
        .or(`thumbnail_url.eq.${oldProxyUrl1},thumbnail_url.eq.${oldProxyUrl2},thumbnail_url.eq.${oldSupabaseUrl}`);

      for (const stl of stls || []) {
        const newThumb = stl.thumbnail_url?.includes(file.name) ? newProxyUrl : stl.thumbnail_url;
        const newPhotos = (stl.photos || []).map((u: string) =>
          u?.includes(file.name) ? newProxyUrl : u
        );

        await sb.from("telegram_indexed_stls").update({
          thumbnail_url: newThumb,
          photos: newPhotos,
        }).eq("id", stl.id);
        dbUpdated++;
        console.log(`    📝 DB: ${stl.id.slice(0, 8)} atualizado`);
      }
    }
  }

  console.log(`\n✅ Concluído!`);
  console.log(`   Uploads R2: ${uploaded}`);
  console.log(`   DB updates: ${dbUpdated}`);
  console.log(`   Erros:      ${errors}`);
}

main().catch(e => { console.error("💥", e.message); process.exit(1); });
