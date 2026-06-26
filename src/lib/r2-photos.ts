// src/lib/r2-photos.ts
// Upload/delete de fotos e avatars no R2 (bucket lb-stls, prefixos photos/ e avatars/).
// Segue o mesmo padrão de src/lib/r2.ts — lê env vars de forma lazy.

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

function env() {
  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  };
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

export function isR2PhotosConfigured(): boolean {
  const e = env();
  return Boolean(e.accountId && e.accessKeyId && e.secretAccessKey && e.bucket);
}

/**
 * Retorna a URL de acesso público a um objeto no R2.
 * Usa o proxy Next.js /api/photo porque r2.cloudflarestorage.com requer auth.
 * Se R2_PUBLIC_URL estiver definido (domínio customizado ou r2.dev), usa ele diretamente.
 */
export function getR2Url(key: string): string {
  const publicBase = process.env.R2_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/${key}`;
  }
  // Proxy interno — funciona sem configuração adicional
  return `/api/photo?key=${encodeURIComponent(key)}`;
}

/**
 * Faz upload de um Buffer para R2 sob o key informado.
 * Retorna a URL pública do arquivo.
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType = "image/jpeg"
): Promise<string> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env().bucket!,
      Key: key,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: contentType,
    })
  );
  return getR2Url(key);
}

/**
 * Faz upload de uma foto para R2 sob o prefixo `photos/`.
 * Preserva o nome original do arquivo.
 * Retorna a URL pública.
 */
export async function uploadPhotoToR2(buffer: Buffer, filename: string): Promise<string> {
  const key = `photos/${filename}`;
  return uploadBufferToR2(buffer, key, "image/jpeg");
}

/**
 * Faz upload de um avatar para R2 sob o prefixo `avatars/`.
 * Retorna a URL pública.
 */
export async function uploadAvatarToR2(buffer: Buffer, filename: string): Promise<string> {
  const key = `avatars/${filename}`;
  return uploadBufferToR2(buffer, key, "image/jpeg");
}

/** Deleta um objeto do R2 pelo key completo (ex: `photos/photo_123.jpg`). */
export async function deleteFromR2(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: env().bucket!, Key: key })
  );
}
