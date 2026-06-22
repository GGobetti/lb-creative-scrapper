import { initTelegramClient, disconnectClient } from "./telegram/client";
import { loadConfig } from "./config";

(async () => {
  const config = loadConfig();
  let client = null;

  try {
    client = await initTelegramClient({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      session: config.telegram.session,
    });

    const groupId = "-1004497395268";
    const entity = await client.getEntity(groupId);
    
    console.log(`\n📂 Grupo: ${(entity as any).title}\n`);

    const messages = await client.getMessages(entity, { limit: 100 });
    
    console.log(`📊 Últimas 100 mensagens:\n`);

    messages.forEach((msg: any, idx: number) => {
      const date = typeof msg.date === "number" 
        ? new Date(msg.date * 1000).toLocaleString("pt-BR")
        : new Date(msg.date).toLocaleString("pt-BR");

      if (msg.media) {
        const mediaType = msg.media.className;
        
        if (mediaType === "MessageMediaDocument") {
          const doc = (msg.media as any).document;
          const attr = doc.attributes?.find((a: any) => "fileName" in a);
          const fileName = attr?.fileName || "desconhecido";
          const size = doc?.size || 0;
          console.log(`${idx + 1}. 📄 ARQUIVO: ${fileName} (${(size / 1024 / 1024).toFixed(1)}MB) - ${date}`);
        } else if (mediaType === "MessageMediaPhoto") {
          console.log(`${idx + 1}. 📸 FOTO - ${date}`);
        } else {
          console.log(`${idx + 1}. ${mediaType} - ${date}`);
        }
      } else if (msg.message) {
        console.log(`${idx + 1}. 💬 TEXTO: "${msg.message.substring(0, 50)}" - ${date}`);
      } else {
        console.log(`${idx + 1}. ??? - ${date}`);
      }
    });

  } catch (e: any) {
    console.error(`Erro: ${e.message}`);
  } finally {
    if (client) await disconnectClient(client);
  }
})();
