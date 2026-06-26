// Proxy de fotos do R2 — necessário porque r2.cloudflarestorage.com requer auth.
// Recebe: GET /api/photo?key=photos/photo_123.jpg
// Retorna: a imagem diretamente do R2 com cache de 1 ano.

import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

function getClient() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return new NextResponse("Missing key", { status: 400 });
  }

  // Segurança: só permite chaves dentro de prefixos autorizados (não stl/)
  if (!key.startsWith("photos/") && !key.startsWith("avatars/") && !key.startsWith("local-upload/")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const result = await getClient().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
      })
    );

    // AWS SDK v3 retorna Node.js Readable, não Web ReadableStream
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as Readable) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": result.ContentType || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e: any) {
    if (e.name === "NoSuchKey") {
      return new NextResponse("Not Found", { status: 404 });
    }
    console.error("[api/photo] R2 error:", e.message);
    return new NextResponse("Error", { status: 500 });
  }
}
