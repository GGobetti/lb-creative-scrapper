import { initTelegramClient, disconnectClient } from "./telegram/client";
import { loadConfig } from "./config";

(async () => {
  const config = loadConfig();
  console.log("\n🔍 Testando acesso ao novo grupo...\n");

  let client = null;
  try {
    client = await initTelegramClient({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      session: config.telegram.session,
    });

    const groupId = "-5434911877";
    console.log(`Tentando acessar: ${groupId}\n`);

    const entity = await client.getEntity(groupId);
    console.log(`✅ Grupo encontrado!\n`);
    console.log(`  Nome: ${(entity as any).title || (entity as any).username || "N/A"}`);
    console.log(`  ID: ${(entity as any).id}`);

    // Tentar buscar mensagens
    const messages = await client.getMessages(entity, { limit: 5 });
    console.log(`\n✅ Conseguiu buscar ${messages.length} mensagens!`);
    
    if (messages.length > 0) {
      console.log(`\n📊 Últimas mensagens:`);
      messages.slice(0, 3).forEach((msg: any, idx: number) => {
        const date = typeof msg.date === "number" 
          ? new Date(msg.date * 1000).toLocaleString("pt-BR")
          : new Date(msg.date).toLocaleString("pt-BR");
        console.log(`  ${idx + 1}. ${date}`);
      });
    }

  } catch (e: any) {
    console.error(`❌ Erro:\n${e.message}\n`);
    console.log(`⚠️  Possíveis causas:`);
    console.log(`  1. Você não é membro do grupo`);
    console.log(`  2. Grupo foi deletado ou é privado`);
    console.log(`  3. ID está errado\n`);
  } finally {
    if (client) await disconnectClient(client);
  }
})();
