import dotenv from "dotenv";

dotenv.config();

export interface Config {
  telegram: {
    apiId: number;
    apiHash: string;
    session: string;
    vaultChannelId: string;
    proxyApiKey: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
}

export function loadConfig(): Config {
  const missing: string[] = [];

  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = process.env.TELEGRAM_SESSION;
  const vaultId = process.env.TELEGRAM_VAULT_CHANNEL_ID;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiId) missing.push("TELEGRAM_API_ID");
  if (!apiHash) missing.push("TELEGRAM_API_HASH");
  if (!session) missing.push("TELEGRAM_SESSION");
  if (!vaultId) missing.push("TELEGRAM_VAULT_CHANNEL_ID");
  if (!sbUrl) missing.push("SUPABASE_URL");
  if (!sbKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    console.error(`❌ Variáveis de ambiente faltando: ${missing.join(", ")}`);
    process.exit(1);
  }

  return {
    telegram: {
      apiId: parseInt(apiId!, 10),
      apiHash: apiHash!,
      session: session!,
      vaultChannelId: vaultId!,
      proxyApiKey: process.env.TELEGRAM_PROXY_API_KEY || "",
    },
    supabase: {
      url: sbUrl!,
      serviceRoleKey: sbKey!,
    },
  };
}
