import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

export async function initTelegramClient(config: {
  apiId: number;
  apiHash: string;
  session: string;
}): Promise<TelegramClient> {
  const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await ask("Telefone (ex: +5511999999999): "),
    password: async () => await ask("Senha 2FA (se aplicável): "),
    phoneCode: async () => await ask("Código de verificação: "),
    onError: (err: any) => console.error("Erro na autenticação:", err),
  });

  if (!config.session) {
    const saved = client.session.save() as any;
    console.log("\n===========================================================");
    console.log("PRIMEIRO LOGIN — salve esta linha no seu .env:");
    console.log(`TELEGRAM_SESSION=${saved}`);
    console.log("===========================================================\n");
  }

  const me = await client.getMe();
  console.log(`✅ Conectado como: ${(me as any).firstName || "Usuário"} (ID: ${(me as any).id})`);

  rl.close();
  return client;
}

export async function disconnectClient(client: TelegramClient): Promise<void> {
  try {
    await client.disconnect();
    console.log("✅ Desconectado do Telegram.");
  } catch (err: any) {
    console.warn(`⚠️  Erro ao desconectar: ${err.message}`);
  }
}
