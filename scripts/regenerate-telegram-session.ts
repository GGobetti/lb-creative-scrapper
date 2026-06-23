/**
 * Regenera a sessão do Telegram (útil quando expirou ou foi invalidada).
 *
 * Uso: npm run regen:telegram
 *
 * O script vai pedir o número do Telegram e o código de confirmação.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "");
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!apiId || !apiHash) {
    console.error("❌ TELEGRAM_API_ID e TELEGRAM_API_HASH são obrigatórios no .env");
    process.exit(1);
  }

  console.log("🔄 Iniciando novo login no Telegram...\n");

  const client = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      requestRetries: 5,
      useWSS: false,
    }
  );

  try {
    await client.start({
      phoneNumber: async () => {
        const phone = await prompt("📱 Número de telefone (com código do país, ex: +5511999999999): ");
        return phone;
      },
      password: async () => {
        console.log("\n⚠️  2FA detectado. Passe de autenticação:");
        const pass = await prompt("🔐 Senha 2FA: ");
        return pass;
      },
      phoneCode: async () => {
        const code = await prompt("📧 Código enviado (via SMS/Telegram): ");
        return code;
      },
      onError: (err: any) => {
        console.error("❌ Erro no Telegram:", err.message);
      },
    });

    const sessionString = client.session.save();
    console.log("\n✅ Login bem-sucedido!");
    console.log("\n📋 Copie e cole isso no .env (coluna TELEGRAM_SESSION):\n");
    console.log(sessionString);
    console.log("\n");

    await client.disconnect();
    rl.close();
    process.exit(0);
  } catch (error: any) {
    console.error("❌ Erro:", error.message);
    rl.close();
    process.exit(1);
  }
}

main();
