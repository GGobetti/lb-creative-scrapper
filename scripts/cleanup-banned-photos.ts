/**
 * Script: Limpeza Retroativa de Fotos Banidas
 *
 * Lê todas as URLs em telegram_banned_images e remove essas URLs
 * dos arrays photos em telegram_indexed_stls e telegram_scraper_jobs.
 *
 * Uso: npm run cleanup:banned
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  console.log("🧹 Limpeza retroativa de fotos banidas\n");

  // 1. Buscar todas as URLs banidas
  const { data: banned, error: bannedError } = await supabase
    .from("telegram_banned_images")
    .select("image_url");

  if (bannedError) {
    console.error("❌ Erro ao buscar banidos:", bannedError.message);
    process.exit(1);
  }

  if (!banned || banned.length === 0) {
    console.log("ℹ️  Nenhuma foto banida encontrada.");
    process.exit(0);
  }

  const bannedUrls = new Set(banned.map((b: any) => b.image_url).filter(Boolean));
  console.log(`🚫 ${bannedUrls.size} URLs banidas encontradas\n`);

  let stlsCleaned = 0;
  let jobsCleaned = 0;

  // 2. Limpar telegram_indexed_stls
  console.log("📚 Processando telegram_indexed_stls...");
  const { data: allStls } = await supabase
    .from("telegram_indexed_stls")
    .select("id, file_name, photos")
    .eq("is_deleted", false);

  for (const stl of (allStls || [])) {
    const photos: string[] = stl.photos || [];
    const hasBanned = photos.some((url: string) => bannedUrls.has(url));
    if (!hasBanned) continue;

    const updatedPhotos = photos.filter((url: string) => !bannedUrls.has(url));
    const { error } = await supabase
      .from("telegram_indexed_stls")
      .update({ photos: updatedPhotos })
      .eq("id", stl.id);

    if (error) {
      console.error(`  ❌ STL ${stl.file_name}: ${error.message}`);
    } else {
      const removed = photos.length - updatedPhotos.length;
      console.log(`  ✅ STL: ${stl.file_name} (${removed} foto(s) removida(s))`);
      stlsCleaned++;
    }
  }

  // 3. Limpar telegram_scraper_jobs
  console.log(`\n🔧 Processando telegram_scraper_jobs...`);
  const { data: allJobs } = await supabase
    .from("telegram_scraper_jobs")
    .select("id, file_name, photos")
    .neq("file_name", "__photo_bucket__")
    .not("photos", "is", null);

  for (const job of (allJobs || [])) {
    const photos: string[] = job.photos || [];
    const hasBanned = photos.some((url: string) => bannedUrls.has(url));
    if (!hasBanned) continue;

    const updatedPhotos = photos.filter((url: string) => !bannedUrls.has(url));
    const { error } = await supabase
      .from("telegram_scraper_jobs")
      .update({ photos: updatedPhotos })
      .eq("id", job.id);

    if (error) {
      console.error(`  ❌ Job ${job.file_name}: ${error.message}`);
    } else {
      const removed = photos.length - updatedPhotos.length;
      console.log(`  ✅ Job: ${job.file_name} (${removed} foto(s) removida(s))`);
      jobsCleaned++;
    }
  }

  console.log(`\n🏁 Limpeza concluída!`);
  console.log(`   - STLs limpos: ${stlsCleaned}`);
  console.log(`   - Jobs limpos: ${jobsCleaned}`);
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
