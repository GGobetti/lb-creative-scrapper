/**
 * Backfill: copia os STLs já indexados que ainda estão no Telegram Vault para o Cloudflare R2.
 *
 * Quando rodar: UMA vez, depois de configurar as credenciais R2 (ver docs/R2_SETUP.md).
 * Pré-requisitos: .env com Telegram (sessão) + Supabase + R2 preenchidos.
 *
 * Uso:  npm run backfill:r2
 *
 * Idempotente: só processa linhas com r2_object_key NULL; ao concluir cada uma, grava a chave,
 * então pode ser interrompido e retomado sem reprocessar.
 */
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { initTelegramClient, disconnectClient } from "../src/telegram/client";
import { isR2Configured, uploadToR2 } from "../src/lib/r2";

async function main() {
  if (!isR2Configured()) {
    console.error("❌ R2 não configurado. Preencha R2_* no .env (ver docs/R2_SETUP.md).");
    process.exit(1);
  }

  const config = loadConfig();
  const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

  const client = await initTelegramClient({
    apiId: config.telegram.apiId,
    apiHash: config.telegram.apiHash,
    session: config.telegram.session,
    connectionRetries: 10,        // Mais tentativas de reconexão
    requestRetries: 5,             // Mais tentativas de requisição
    floodSleepThreshold: 100,      // Mais tolerante com rate limits
  });

  let vault: any;
  try {
    vault = await client.getEntity(config.telegram.vaultChannelId);
  } catch (e: any) {
    console.error(`❌ Não consegui acessar o Vault (${config.telegram.vaultChannelId}): ${e.message}`);
    await disconnectClient(client);
    process.exit(1);
  }

  const tempDir = path.join(process.cwd(), ".temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let processed = 0;
  let failed = 0;
  const PAGE = 100;

  while (true) {
    const { data: rows, error } = await supabase
      .from("telegram_indexed_stls")
      .select("id, file_name, file_hash, telegram_message_id")
      .is("r2_object_key", null)
      .eq("is_deleted", false)
      .not("telegram_message_id", "is", null)
      .limit(PAGE);

    if (error) { console.error(`❌ Erro no Supabase: ${error.message}`); break; }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const tmp = path.join(tempDir, `backfill_${row.id}`);
      try {
        const msgs = await client.getMessages(vault, { ids: [row.telegram_message_id] });
        const msg: any = msgs?.[0];
        if (!msg || !msg.media) {
          console.warn(`⚠️  ${row.file_name}: mensagem ${row.telegram_message_id} não encontrada no Vault`);
          failed++;
          continue;
        }

        const downloaded = await client.downloadMedia(msg, { outputFile: tmp });
        if (!downloaded || !fs.existsSync(tmp)) {
          console.warn(`⚠️  ${row.file_name}: download falhou`);
          failed++;
          continue;
        }

        const ext = (row.file_name?.split(".").pop() || "bin").toLowerCase();
        const base = row.file_hash || `legacy_${row.id}`;
        const key = `stl/${base}.${ext}`;

        await uploadToR2(key, tmp, row.file_name);
        try { fs.unlinkSync(tmp); } catch {}

        const { error: upErr } = await supabase
          .from("telegram_indexed_stls")
          .update({ r2_object_key: key })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);

        processed++;
        console.log(`✅ ${row.file_name} → ${key}`);
      } catch (e: any) {
        failed++;
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        console.error(`❌ ${row.file_name}: ${e.message}`);
      }
    }
  }

  console.log(`\n🏁 Backfill concluído: ${processed} migrados, ${failed} falhas.`);
  await disconnectClient(client);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro fatal no backfill:", e);
  process.exit(1);
});
