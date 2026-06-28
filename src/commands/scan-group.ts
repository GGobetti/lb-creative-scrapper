import { TelegramClient } from "telegram";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";
import { initTelegramClient, disconnectClient } from "../telegram/client";
import { VaultUploader } from "../telegram/vault";
import { ScraperCore } from "../scraper/core";
import { BufferedMessage } from "../scraper/types";

function isEligibleDoc(msg: any): boolean {
  if (!msg.media) return false;

  // Suporta ambas as estruturas
  const hasDocument = "document" in msg.media || msg.media?.className === "MessageMediaDocument";
  if (!hasDocument) return false;

  const doc = (msg.media as any).document;
  const attr = doc.attributes?.find((a: any) => "fileName" in a);
  const fileName = attr?.fileName || "";
  return /\.(stl|3mf|zip|rar|7z)$/i.test(fileName);
}

function isPhoto(msg: any): boolean {
  return !!(msg.photo || (msg.media && ("photo" in msg.media || msg.media?.className === "MessageMediaPhoto")));
}

export async function scanGroupCommand(args: { groupId: string; hours?: number }): Promise<void> {
  const config = loadConfig();
  const hoursBack = args.hours ?? 24;
  const groupId = args.groupId;

  if (!groupId) {
    console.error("❌ Group ID é obrigatório. Use: npm run scan-group -- --groupId -1004497395268");
    return;
  }

  let client: TelegramClient | null = null;

  try {
    console.log(`\n🔍 Scan do Grupo ${groupId} (últimas ${hoursBack}h)\n`);

    client = await initTelegramClient({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      session: config.telegram.session,
    });

    const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
    const me = await client.getMe();
    const myId = String((me as any).id);

    const sizeLimitBytes = 750 * 1024 * 1024;

    const vaultUploader = new VaultUploader(client, config.telegram.vaultChannelId);
    const core = new ScraperCore(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      vaultUploader,
      config.telegram.vaultChannelId
    );

    const cutoff = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    // Resolver entidade do grupo
    let entity: any = null;
    try {
      entity = await client.getEntity(groupId);
    } catch (e: any) {
      console.error(`❌ Grupo "${groupId}" não encontrado`);
      return;
    }

    const chatTitle = entity.title || entity.username || groupId;
    const chatId = String(entity.id);
    const printerType = "fdm";

    console.log(`📂 Varrendo: "${chatTitle}" (${chatId})\n`);

    let messages: any[] = [];
    try {
      // Tenta buscar com limit maior para capturar histórico completo
      messages = await client.getMessages(entity, { limit: 0 }); // 0 = sem limite
    } catch (e: any) {
      // Se limit 0 não funcionar, tenta com número grande
      try {
        messages = await client.getMessages(entity, { limit: 10000 });
      } catch (e2: any) {
        console.error(`❌ Erro ao buscar msgs: ${e2.message}`);
        return;
      }
    }

    const inWindow = messages.filter((m: any) => {
      const ts = typeof m.date === "number" ? m.date : Math.floor(new Date(m.date).getTime() / 1000);
      return ts >= cutoff;
    });

    console.log(`📨 ${inWindow.length} msgs na janela de ${hoursBack}h\n`);

    // Debug: mostrar o que tem nas mensagens
    let photoCount = 0, docCount = 0, textCount = 0, otherCount = 0;
    for (const msg of inWindow) {
      const mediaType = msg.media?.className || "none";

      if (msg.media && ("document" in msg.media || msg.media?.className === "MessageMediaDocument")) {
        const doc = (msg.media as any).document;
        const attr = doc.attributes?.find((a: any) => "fileName" in a);
        const fileName = attr?.fileName || "desconhecido";
        docCount++;
        console.log(`  📄 ${fileName}`);
      } else if (msg.photo || (msg.media && ("photo" in msg.media || msg.media?.className === "MessageMediaPhoto"))) {
        photoCount++;
      } else if (msg.message) {
        textCount++;
        console.log(`  💬 "${msg.message.substring(0, 50)}"`);
      } else {
        otherCount++;
        console.log(`  🔹 OUTRO (${mediaType})`);
        console.log(`     Tem fwd_from? ${msg.fwdFrom ? "SIM ✓" : "NÃO"}`);
        console.log(`     Tem grouped_id? ${msg.groupedId ? "SIM ✓" : "NÃO"}`);
        console.log(`     className: ${msg.className}`);
        if (msg.fwdFrom) {
          console.log(`     Forward from: ${msg.fwdFrom.fromName || msg.fwdFrom.fromId}`);
        }
      }
    }
    console.log(`\n  Breakdown: 📄${docCount} 📸${photoCount} 💬${textCount} 🔹${otherCount}\n`);

    const senderGroups = new Map<string, BufferedMessage[]>();

    for (const msg of [...inWindow].reverse()) {
      const senderId = msg.senderId ? String(msg.senderId) : "unknown";
      // NOTA: scan-group processa TUDO, inclusive mensagens do próprio user
      // (o daemon filtra suas próprias mensagens para não reprocessar)

      const isDoc = isEligibleDoc(msg);
      const isPic = isPhoto(msg);
      if (!isDoc && !isPic) continue;

      if (!senderGroups.has(senderId)) senderGroups.set(senderId, []);
      senderGroups.get(senderId)!.push({ message: msg, type: isDoc ? "document" : "photo" });
    }

    let totalQueued = 0;

    for (const [senderId, buffered] of senderGroups) {
      const docs = buffered.filter(m => m.type === "document");
      if (docs.length === 0) continue;

      console.log(`\n👤 De ${senderId}: ${docs.length} arquivo(s)`);

      const newDocs: BufferedMessage[] = [];
      for (const docItem of docs) {
        const doc = (docItem.message.media as any).document;
        const attr = doc.attributes?.find((a: any) => "fileName" in a);
        const fileName = attr?.fileName || "arquivo.stl";
        const fileSize = Number(doc.size);

        if (fileSize > sizeLimitBytes) {
          console.log(`   ❌ "${fileName}" acima do limite (${(fileSize / 1024 / 1024).toFixed(0)}MB)`);
          continue;
        }

        console.log(`   ✅ "${fileName}" (${(fileSize / 1024 / 1024).toFixed(1)}MB) - será processado`);
        newDocs.push(docItem);
        totalQueued++;
      }

      if (newDocs.length === 0) {
        console.log(`   ⚠️  Nenhum arquivo válido neste grupo`);
        continue;
      }

      const photos = buffered.filter(m => m.type === "photo");
      console.log(`   📸 ${photos.length} foto(s) associada(s)\n`);
      await core.processGroupMessages(client, [...newDocs, ...photos], chatTitle, chatId, printerType);
    }

    core.saveHashCache();

    // Atualizar heartbeat
    const supabaseHeartbeat = createClient(config.supabase.url, config.supabase.serviceRoleKey);
    await supabaseHeartbeat
      .from("telegram_scraper_settings")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("id", "default");

    console.log(`\n✅ Scan concluído!`);
    console.log(`   📥 ${totalQueued} arquivo(s) processado(s)\n`);

  } catch (e: any) {
    console.error(`\n❌ Erro fatal: ${e.message}`);
  } finally {
    if (client) await disconnectClient(client);
  }
}
