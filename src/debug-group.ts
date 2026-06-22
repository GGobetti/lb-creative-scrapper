import { initTelegramClient, disconnectClient } from "./telegram/client";
import { loadConfig } from "./config";

(async () => {
  const config = loadConfig();
  console.log("\n🔍 Debug: Analisando grupo...\n");

  let client = null;
  try {
    client = await initTelegramClient({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      session: config.telegram.session,
    });

    const groupId = "-1004497395268";
    const entity = await client.getEntity(groupId);
    
    console.log(`✅ Grupo encontrado: ${(entity as any).title}\n`);

    // Buscar mensagens dos últimos 2 horas
    const cutoff = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    const messages = await client.getMessages(entity, { limit: 100 });
    
    const recentMsgs = messages.filter((m: any) => {
      const ts = typeof m.date === "number" ? m.date : Math.floor(new Date(m.date).getTime() / 1000);
      return ts >= cutoff;
    });

    console.log(`📊 Mensagens últimas 2h: ${recentMsgs.length}\n`);

    let fileCount = 0;
    let photoCount = 0;

    recentMsgs.forEach((msg: any) => {
      const isFile = msg.media && msg.media.className === "MessageMediaDocument";
      const isPhoto = msg.media && (msg.media.className === "MessageMediaPhoto" || msg.photo);

      if (isFile) {
        fileCount++;
        const doc = (msg.media as any).document;
        const fileName = doc?.attributes?.find((a: any) => "fileName" in a)?.fileName || "?";
        const size = doc?.size || 0;
        console.log(`📄 ${fileName} (${(size / 1024 / 1024).toFixed(1)}MB)`);
      }

      if (isPhoto) {
        photoCount++;
      }
    });

    console.log(`\n📊 TOTAL:`);
    console.log(`   Arquivos: ${fileCount}`);
    console.log(`   Fotos: ${photoCount}\n`);

  } catch (e: any) {
    console.error(`❌ Erro: ${e.message}\n`);
  } finally {
    if (client) await disconnectClient(client);
  }
})();
