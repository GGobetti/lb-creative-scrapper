import { TelegramClient } from "telegram";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";
import { initTelegramClient, disconnectClient } from "../telegram/client";
import { VaultUploader } from "../telegram/vault";
import { ScraperCore } from "../scraper/core";
import { BufferedMessage } from "../scraper/types";

function isEligibleDoc(msg: any): boolean {
  if (!msg.media || !("document" in msg.media)) return false;
  const doc = (msg.media as any).document;
  const attr = doc.attributes?.find((a: any) => "fileName" in a);
  const fileName = attr?.fileName || "";
  return /\.(stl|3mf|zip|rar|7z)$/i.test(fileName);
}

function isPhoto(msg: any): boolean {
  return !!(msg.photo || (msg.media && ("photo" in msg.media || msg.media?.className === "MessageMediaPhoto")));
}

export async function scanCommand(args: { hours?: number }): Promise<void> {
  const config = loadConfig();
  const hoursBack = args.hours ?? 24;
  let client: TelegramClient | null = null;

  try {
    console.log(`\n🔍 LB Creative Scraper — scan das últimas ${hoursBack}h\n`);

    client = await initTelegramClient({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      session: config.telegram.session,
    });

    const me = await client.getMe();
    const myId = String((me as any).id);

    // Carregar configuração de grupos do Supabase
    const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
    const { data: settings } = await supabase
      .from("telegram_scraper_settings")
      .select("groups_config, size_limit_mb")
      .eq("id", "default")
      .single();

    if (!settings?.groups_config?.length) {
      console.error("❌ Nenhum grupo configurado em telegram_scraper_settings.");
      return;
    }

    const sizeLimitBytes = (settings.size_limit_mb || 750) * 1024 * 1024;
    const groupsConfig: Array<{ id: string; type: string }> = settings.groups_config;

    console.log(`📋 ${groupsConfig.length} grupo(s) configurado(s)\n`);

    const vaultUploader = new VaultUploader(client, config.telegram.vaultChannelId);
    const core = new ScraperCore(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      vaultUploader,
      config.telegram.vaultChannelId
    );

    const cutoff = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);
    let totalQueued = 0;
    let totalSkipped = 0;

    const dialogs = await client.getDialogs({ limit: 500 });

    for (const groupConf of groupsConfig) {
      const printerType = groupConf.type || "fdm";

      // Resolver entidade do grupo
      let entity: any = null;
      try {
        entity = await client.getEntity(groupConf.id);
      } catch {
        // Tentar via dialogs pelo título ou username
        const dialog = dialogs.find((d: any) =>
          String(d.id) === groupConf.id ||
          d.title?.toLowerCase() === groupConf.id.toLowerCase() ||
          d.entity?.username?.toLowerCase() === groupConf.id.toLowerCase()
        );
        if (dialog) entity = dialog.entity;
      }

      if (!entity) {
        console.warn(`⚠️  Grupo "${groupConf.id}" não encontrado, pulando`);
        continue;
      }

      const chatTitle = entity.title || entity.username || groupConf.id;
      const chatId = String(entity.id);
      console.log(`\n📂 Varrendo: "${chatTitle}" (${chatId})`);

      // Normalizar vault ID para excluir
      const normVault = config.telegram.vaultChannelId.replace(/^-100/, "");
      const normChat = chatId.replace(/^-100/, "");
      if (normChat === normVault) {
        console.log(`   ⏩ É o próprio Vault, pulando`);
        continue;
      }

      let messages: any[] = [];
      try {
        messages = await client.getMessages(entity, { limit: 500 });
      } catch (e: any) {
        console.error(`   ❌ Erro ao buscar msgs: ${e.message}`);
        continue;
      }

      // Filtrar pela janela de tempo e agrupar por sender (buffer de 5 msgs)
      const inWindow = messages.filter((m: any) => {
        const ts = typeof m.date === "number" ? m.date : Math.floor(new Date(m.date).getTime() / 1000);
        return ts >= cutoff;
      });

      console.log(`   📨 ${inWindow.length} msgs na janela de ${hoursBack}h`);

      // Agrupar mensagens por sender (janela de agrupamento de IDs próximos)
      const senderGroups = new Map<string, BufferedMessage[]>();

      for (const msg of [...inWindow].reverse()) {
        const senderId = msg.senderId ? String(msg.senderId) : "unknown";
        if (myId && senderId === myId) continue;

        const isDoc = isEligibleDoc(msg);
        const isPic = isPhoto(msg);
        if (!isDoc && !isPic) continue;

        if (!senderGroups.has(senderId)) senderGroups.set(senderId, []);
        senderGroups.get(senderId)!.push({ message: msg, type: isDoc ? "document" : "photo" });
      }

      for (const [senderId, buffered] of senderGroups) {
        const docs = buffered.filter(m => m.type === "document");
        if (docs.length === 0) continue;

        // Verificar duplicatas
        const newDocs: BufferedMessage[] = [];
        for (const docItem of docs) {
          const doc = (docItem.message.media as any).document;
          const attr = doc.attributes?.find((a: any) => "fileName" in a);
          const fileName = attr?.fileName || "arquivo.stl";
          const fileSize = Number(doc.size);

          if (fileSize > sizeLimitBytes) {
            console.log(`   ⏩ "${fileName}" acima do limite (${(fileSize / 1024 / 1024).toFixed(0)}MB), pulando`);
            totalSkipped++;
            continue;
          }

          const { data: ex } = await supabase
            .from("telegram_indexed_stls")
            .select("id")
            .eq("file_name", fileName)
            .eq("file_size_bytes", fileSize)
            .limit(1)
            .maybeSingle();

          if (ex) { totalSkipped++; continue; }

          const { data: exJob } = await supabase
            .from("telegram_scraper_jobs")
            .select("id")
            .eq("file_name", fileName)
            .eq("file_size_bytes", fileSize)
            .in("status", ["downloading_file", "uploading_vault", "indexing", "pending_approval"])
            .limit(1)
            .maybeSingle();

          if (exJob) { totalSkipped++; continue; }

          newDocs.push(docItem);
          totalQueued++;
        }

        if (newDocs.length === 0) continue;

        const photos = buffered.filter(m => m.type === "photo");
        await core.processGroupMessages(client, [...newDocs, ...photos], chatTitle, chatId, printerType);
      }
    }

    core.saveHashCache();

    // Atualizar heartbeat na web app
    const supabaseHeartbeat = createClient(config.supabase.url, config.supabase.serviceRoleKey);
    await supabaseHeartbeat
      .from("telegram_scraper_settings")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("id", "default");

    console.log(`\n✅ Scan concluído!`);
    console.log(`   📥 ${totalQueued} arquivo(s) processado(s)`);
    console.log(`   ⏩ ${totalSkipped} arquivo(s) já indexado(s), ignorados\n`);

  } catch (e: any) {
    console.error(`\n❌ Erro fatal: ${e.message}`);
    process.exit(1);
  } finally {
    if (client) await disconnectClient(client);
  }
}
