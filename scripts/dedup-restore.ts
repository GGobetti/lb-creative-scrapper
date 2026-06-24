/**
 * Script: Restaurar backup do dedup
 *
 * Se algo deu errado na consolidação, restaura do backup.
 *
 * Uso: npm run dedup:restore -- <backup-file.json>
 * Exemplo: npm run dedup:restore -- dedup-backup-2026-06-23T23-58-34-000Z.json
 */
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import fs from "fs";
import path from "path";

interface BackupFile {
  timestamp: string;
  totalStls: number;
  stls: Array<{ id: string; file_name: string; photos: string[] }>;
}

async function main() {
  const backupFile = process.argv[2];

  if (!backupFile) {
    console.log("❌ Uso: npm run dedup:restore -- <backup-file.json>\n");
    console.log("Exemplo: npm run dedup:restore -- dedup-backup-2026-06-23T23-58-34-000Z.json\n");
    console.log("Arquivos de backup disponíveis:");
    const files = fs.readdirSync(process.cwd()).filter((f) => f.startsWith("dedup-backup-"));
    if (files.length === 0) {
      console.log("  (nenhum backup encontrado)");
    } else {
      files.forEach((f) => console.log(`  - ${f}`));
    }
    process.exit(1);
  }

  const backupPath = path.join(process.cwd(), backupFile);

  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Arquivo não encontrado: ${backupPath}`);
    process.exit(1);
  }

  console.log(`📖 Lendo backup: ${backupFile}\n`);

  let backup: BackupFile;
  try {
    backup = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
  } catch (err) {
    console.error(`❌ Erro ao ler backup: ${err}`);
    process.exit(1);
  }

  console.log(`⏰ Backup de: ${backup.timestamp}`);
  console.log(`📦 STLs no backup: ${backup.totalStls}\n`);

  // Confirmar antes de restaurar
  console.log("⚠️  AVISO: Isso vai restaurar TODOS os STLs para o estado anterior!\n");
  console.log("Para confirmar a restauração, rode:");
  console.log(`  npm run dedup:restore -- ${backupFile} -- --confirm\n`);

  if (!process.argv.includes("--confirm")) {
    process.exit(0);
  }

  // Restaurar
  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  console.log("🔄 Restaurando backup...\n");

  let restoredCount = 0;
  let errorCount = 0;

  for (const stl of backup.stls) {
    const { error: updateError } = await supabase
      .from("telegram_indexed_stls")
      .update({ photos: stl.photos })
      .eq("id", stl.id);

    if (updateError) {
      console.error(`❌ Erro ao restaurar ${stl.file_name}: ${updateError.message}`);
      errorCount++;
    } else {
      console.log(`✅ ${stl.file_name}`);
      restoredCount++;
    }
  }

  console.log(`\n🏁 Restauração concluída!`);
  console.log(`   - Restaurados: ${restoredCount}`);
  console.log(`   - Erros: ${errorCount}\n`);

  if (errorCount === 0) {
    console.log("✅ Banco retornou ao estado anterior com sucesso!\n");
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
