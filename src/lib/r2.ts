// src/lib/r2.ts
// Cliente Cloudflare R2 (S3-compatível) — upload dos STLs na ingestão.
// Armazém-mestre + entrega (substitui o Telegram Vault). Ver ARCHITECTURE.md §6.
// As variáveis são lidas de forma lazy (dentro das funções) para garantir que
// dotenv.config() (em config.ts) já tenha rodado antes da leitura.

import fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function env() {
  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  };
}

/** true quando todas as credenciais R2 estão presentes no ambiente. */
export function isR2Configured(): boolean {
  const e = env();
  return Boolean(e.accountId && e.accessKeyId && e.secretAccessKey && e.bucket);
}

let _client: S3Client | undefined;
function getClient(): S3Client {
  if (_client) return _client;
  const e = env();
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${e.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: e.accessKeyId!, secretAccessKey: e.secretAccessKey! },
  });
  return _client;
}

/**
 * Sobe um arquivo do disco para o bucket R2 sob a chave informada.
 * Faz streaming (não carrega o arquivo inteiro em memória).
 */
export async function uploadToR2(objectKey: string, filePath: string, downloadName?: string): Promise<void> {
  const { size } = fs.statSync(filePath);
  await getClient().send(
    new PutObjectCommand({
      Bucket: env().bucket,
      Key: objectKey,
      Body: fs.createReadStream(filePath),
      ContentLength: size,
      ContentType: "application/octet-stream",
      ...(downloadName
        ? { ContentDisposition: `attachment; filename="${encodeURIComponent(downloadName)}"` }
        : {}),
    })
  );
}
