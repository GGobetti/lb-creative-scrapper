import fs from "fs";
import path from "path";
import crypto from "crypto";
import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getPerceptualHash, hammingDistance } from "./imageHash";
import { VaultUploader } from "../telegram/vault";
import { BufferedMessage, GroupConfig } from "./types";

const QUEUE_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const STOP_WORDS = new Set([
  "zip","rar","stl","3mf","3d","print","model","free","with","and","the","for","from",
  "para","com","del","dos","das","uma","uns","sob","sem","sobre","por","que","keychain",
  "planter","download","gratis","completo","link","key","v2",
]);

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let tid: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    tid = setTimeout(() => reject(new Error(msg)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(tid)) as Promise<T>;
}

async function fetchWithTimeout(url: string, ms = 30_000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

export class ScraperCore {
  private supabase: SupabaseClient;
  private globalPhotoHashCache = new Map<string, string>();
  private entityPhotoHashCache = new Map<string, Set<string>>();
  private cacheFile: string;
  private tempDir: string;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    private vaultUploader: VaultUploader,
    private vaultChannelId: string,
    cacheFile = path.join(process.cwd(), ".temp/photo_hash_cache.json")
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.cacheFile = cacheFile;
    this.tempDir = path.dirname(cacheFile);
    this.loadHashCache();
  }

  loadHashCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
        for (const [h, id] of Object.entries(data)) {
          this.globalPhotoHashCache.set(h, id as string);
        }
        console.log(`[Cache] ${this.globalPhotoHashCache.size} hashes carregados`);
      }
    } catch (e: any) {
      console.warn(`[Cache] Falha ao carregar: ${e.message}`);
    }
  }

  saveHashCache(): void {
    try {
      if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
      const data: Record<string, string> = {};
      for (const [h, id] of this.globalPhotoHashCache) data[h] = id;
      fs.writeFileSync(this.cacheFile, JSON.stringify(data));
      console.log(`[Cache] ${this.globalPhotoHashCache.size} hashes salvos`);
    } catch (e: any) {
      console.warn(`[Cache] Falha ao salvar: ${e.message}`);
    }
  }

  private async downloadMediaWithTimeout(
    client: TelegramClient,
    message: any,
    outputFile: string,
    timeoutMs = 60_000,
    jobId?: string | null
  ): Promise<string> {
    let lastProgress = Date.now();
    let completed = false;

    return new Promise<string>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (completed) return;
        if (Date.now() - lastProgress > timeoutMs) {
          clearInterval(checkInterval);
          completed = true;
          try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch {}
          reject(new Error(`Download timeout: sem progresso por ${timeoutMs / 1000}s`));
        }
      }, 5000);

      client.downloadMedia(message, {
        outputFile,
        progressCallback: (downloaded, total) => {
          lastProgress = Date.now();
          if (total && Number(total) > 50 * 1024 * 1024) {
            const pct = Math.floor((Number(downloaded) / Number(total)) * 100);
            if (jobId) process.stdout.write(`\r[Download] ${pct}%`);
          }
        },
      }).then((res) => {
        clearInterval(checkInterval);
        completed = true;
        if (jobId) console.log("");
        if (res && typeof res === "string") resolve(res);
        else reject(new Error("Retorno inválido do download"));
      }).catch((err) => {
        clearInterval(checkInterval);
        completed = true;
        reject(err);
      });
    });
  }

  private async buildEntityPhotoHashSet(entityId: string, photoUrls: string[]): Promise<Set<string>> {
    if (this.entityPhotoHashCache.has(entityId)) return this.entityPhotoHashCache.get(entityId)!;
    const hashSet = new Set<string>();
    for (const url of photoUrls) {
      try {
        if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
        const tempPath = path.join(this.tempDir, `hashbuild_${Date.now()}.jpg`);
        const res = await fetchWithTimeout(url, 30_000);
        if (!res.ok) continue;
        fs.writeFileSync(tempPath, Buffer.from(await res.arrayBuffer()));
        const h = await getPerceptualHash(tempPath);
        try { fs.unlinkSync(tempPath); } catch {}
        hashSet.add(h);
        this.globalPhotoHashCache.set(h, entityId);
      } catch {}
    }
    this.entityPhotoHashCache.set(entityId, hashSet);
    return hashSet;
  }

  private async deduplicatePhotos(
    candidateUrls: string[],
    photoHashByUrl: Map<string, string>,
    existingHashSet: Set<string>,
    entityId: string,
    bannedHashes: string[]
  ): Promise<string[]> {
    const result: string[] = [];
    for (const url of candidateUrls) {
      let hash = photoHashByUrl.get(url);
      if (!hash) {
        try {
          if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
          const tempPath = path.join(this.tempDir, `hashcheck_${Date.now()}.jpg`);
          const res = await fetchWithTimeout(url, 30_000);
          if (!res.ok) { result.push(url); continue; }
          fs.writeFileSync(tempPath, Buffer.from(await res.arrayBuffer()));
          hash = await getPerceptualHash(tempPath);
          try { fs.unlinkSync(tempPath); } catch {}
          photoHashByUrl.set(url, hash);
        } catch { result.push(url); continue; }
      }

      if (bannedHashes.some(b => hammingDistance(hash!, b) <= 10)) {
        console.log(`[Dedup] Foto banida (propaganda), ignorando`);
        continue;
      }
      let dupSame = false;
      for (const h of existingHashSet) {
        if (hammingDistance(hash!, h) <= 10) { dupSame = true; break; }
      }
      if (dupSame) { console.log(`[Dedup] Duplicata no mesmo arquivo`); continue; }

      let crossOwner: string | null = null;
      for (const [cachedHash, cachedId] of this.globalPhotoHashCache) {
        if (cachedId !== entityId && hammingDistance(hash!, cachedHash) <= 10) {
          crossOwner = cachedId; break;
        }
      }
      if (crossOwner) { console.log(`[Dedup] Foto pertence a outro arquivo (${crossOwner})`); continue; }

      result.push(url);
      existingHashSet.add(hash!);
      this.globalPhotoHashCache.set(hash!, entityId);
    }
    return result;
  }

  private buildTags(fileName: string): string[] {
    return fileName
      .toLowerCase()
      .replace(/\.[^/.]+$/, "")
      .split(/[_\-\s\.\,\(\)\[\]\–]+/)
      .map(t => t.trim())
      .filter(t => t.length > 2 && !STOP_WORDS.has(t) && /^[a-z0-9À-ÿ]+$/i.test(t));
  }

  private formatTitle(fileName: string): string {
    const title = fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/\.(stl|3mf|zip|rar|7z|gcode)$/i, "")
      .replace(/[_\-]+/g, " ");
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  async processGroupMessages(
    client: TelegramClient,
    messages: BufferedMessage[],
    chatTitle: string,
    chatId: string,
    printerType: string
  ): Promise<void> {
    const sorted = [...messages].sort((a, b) => a.message.id - b.message.id);
    const docs = sorted.filter(m => m.type === "document");
    const photos = sorted.filter(m => m.type === "photo");

    if (docs.length === 0) return;

    console.log(`\n[Core] Processando ${docs.length} doc(s), ${photos.length} foto(s) de "${chatTitle}"`);

    // Carregar hashes banidos
    let bannedHashes: string[] = [];
    try {
      const { data } = await this.supabase.from("telegram_banned_images").select("image_hash");
      if (data) bannedHashes = data.map(r => r.image_hash);
    } catch (e: any) {
      console.warn(`[Core] Blacklist não carregada: ${e.message}`);
    }

    // Processar fotos → upload Supabase Storage
    const photoHashByUrl = new Map<string, string>();
    const photoUrlsMap = new Map<number, string>();

    for (let i = 0; i < photos.length; i++) {
      const photoMsg = photos[i].message;
      try {
        console.log(`[Core] Foto ${i + 1}/${photos.length} (msg ${photoMsg.id})...`);
        if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
        const tempPath = path.join(this.tempDir, `photo_${Date.now()}_${i}.jpg`);

        const downloaded = await this.downloadMediaWithTimeout(client, photoMsg, tempPath, 30_000);
        if (!downloaded || !fs.existsSync(downloaded)) continue;

        let photoHash: string | null = null;
        try {
          photoHash = await getPerceptualHash(downloaded);
          if (bannedHashes.some(b => hammingDistance(photoHash!, b) <= 10)) {
            console.log(`[Core] Foto ${photoMsg.id} banida, ignorando`);
            try { fs.unlinkSync(downloaded); } catch {}
            continue;
          }
        } catch {}

        const fileBuffer = fs.readFileSync(downloaded);
        const uploadPath = `telegram/photo_${Date.now()}_${i}.jpg`;
        const { error: upErr } = await this.supabase.storage
          .from("portfolio")
          .upload(uploadPath, fileBuffer, { contentType: "image/jpeg", upsert: true });

        try { fs.unlinkSync(downloaded); } catch {}

        if (upErr) { console.error(`[Core] Erro upload foto: ${upErr.message}`); continue; }

        const { data: { publicUrl } } = this.supabase.storage.from("portfolio").getPublicUrl(uploadPath);
        photoUrlsMap.set(photoMsg.id, publicUrl);
        if (photoHash) photoHashByUrl.set(publicUrl, photoHash);
        console.log(`[Core] Foto disponível: ${publicUrl}`);
      } catch (e: any) {
        console.error(`[Core] Erro foto ${i + 1}: ${e.message}`);
      }
    }

    // Mapear fotos ao doc: mesmo remetente + 30s antes até 5s depois + máx 5 fotos
    const docPhotosMap = new Map<number, string[]>();
    const MAX_PHOTOS_PER_DOC = 5;
    const PHOTO_WINDOW_BEFORE_SECONDS = 30; // Fotos até 30s ANTES do arquivo
    const PHOTO_WINDOW_AFTER_SECONDS = 5;   // Fotos até 5s APÓS do arquivo

    for (const photoItem of photos) {
      const photoMsg = photoItem.message;
      const photoSenderId = String(photoMsg.senderId || "unknown");
      const photoTime = typeof photoMsg.date === "number"
        ? photoMsg.date
        : Math.floor(new Date(photoMsg.date).getTime() / 1000);
      const url = photoUrlsMap.get(photoMsg.id);
      if (!url) continue;

      // Procurar doc do MESMO remetente, dentro da janela de tempo
      let bestMatch: any = null;
      let bestTimeDiff = Infinity;

      for (const docItem of docs) {
        const docMsg = docItem.message;
        const docSenderId = String(docMsg.senderId || "unknown");
        const docTime = typeof docMsg.date === "number"
          ? docMsg.date
          : Math.floor(new Date(docMsg.date).getTime() / 1000);

        const timeDiff = docTime - photoTime; // Arquivo menos foto (pode ser negativo)

        // Mesma pessoa E foto entre 30s antes até 5s depois do arquivo
        if (docSenderId === photoSenderId &&
            timeDiff >= -PHOTO_WINDOW_BEFORE_SECONDS &&
            timeDiff <= PHOTO_WINDOW_AFTER_SECONDS) {
          // Encontrar o arquivo mais próximo
          if (Math.abs(timeDiff) < Math.abs(bestTimeDiff)) {
            bestTimeDiff = timeDiff;
            bestMatch = docMsg;
          }
        }
      }

      if (bestMatch) {
        const list = docPhotosMap.get(bestMatch.id) || [];
        // Limitar a máximo 5 fotos por documento
        if (list.length < MAX_PHOTOS_PER_DOC) {
          list.push(url);
          docPhotosMap.set(bestMatch.id, list);
        }
      }
    }

    // Processar cada documento
    for (const docItem of docs) {
      const docMsg = docItem.message;
      const matchedPhotos = docPhotosMap.get(docMsg.id) || [];
      let jobId: string | null = null;
      let tempFilePath: string | null = null;

      const updateJob = async (status: string, err?: string) => {
        if (!jobId) return;
        await this.supabase
          .from("telegram_scraper_jobs")
          .update({ status, error_message: err || null, updated_at: new Date().toISOString() })
          .eq("id", jobId);
      };

      try {
        const doc = docMsg.media.document as any;
        let fileName = "arquivo.stl";
        const attr = doc.attributes?.find((a: any) => "fileName" in a);
        if (attr) fileName = attr.fileName;
        const fileSize = Number(doc.size);

        // Verificar duplicata no índice
        const { data: existing } = await this.supabase
          .from("telegram_indexed_stls")
          .select("id, photos")
          .eq("file_name", fileName)
          .eq("file_size_bytes", fileSize)
          .limit(1)
          .maybeSingle();

        if (existing) {
          console.log(`[Core] ${fileName} já indexado. Verificando fotos novas...`);
          if (matchedPhotos.length > 0) {
            const existingPhotos = existing.photos || [];
            const entityId = `stl:${existing.id}`;
            const urlDeduped = matchedPhotos.filter(p => !existingPhotos.includes(p));
            if (urlDeduped.length > 0) {
              const existingHashSet = await this.buildEntityPhotoHashSet(entityId, existingPhotos);
              const newPhotos = await this.deduplicatePhotos(urlDeduped, photoHashByUrl, existingHashSet, entityId, bannedHashes);
              if (newPhotos.length > 0) {
                await this.supabase.from("telegram_indexed_stls")
                  .update({ photos: [...existingPhotos, ...newPhotos], has_appended_photos: true })
                  .eq("id", existing.id);
              }
            }
          }
          continue;
        }

        // Criar job no banco
        const { data: jobData } = await this.supabase
          .from("telegram_scraper_jobs")
          .insert({
            file_name: fileName,
            chat_title: chatTitle,
            status: "downloading_file",
            file_size_bytes: fileSize,
            telegram_message_id: docMsg.id,
            telegram_group_id: chatId,
            photos: matchedPhotos,
            printer_type: printerType,
          })
          .select("id")
          .single();

        if (jobData) { jobId = jobData.id; console.log(`[Core] Job criado: ${jobId}`); }

        // Download do arquivo
        if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
        const safeFileName = fileName.replace(/[^\w\.\-]/g, "_");
        tempFilePath = path.join(this.tempDir, `${Date.now()}_${safeFileName}`);

        console.log(`[Core] Baixando ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)...`);
        const mediaData = await this.downloadMediaWithTimeout(client, docMsg, tempFilePath, 60_000, jobId);

        if (!mediaData || !fs.existsSync(mediaData)) {
          await updateJob("failed", "Erro ao salvar no disco");
          continue;
        }

        // Upload para Vault
        await updateJob("uploading_vault");
        const tags = this.buildTags(fileName);
        const title = this.formatTitle(fileName);
        const hashtagStr = tags.map(t => `#${t}`).join(" ");

        const sentId = await withTimeout(
          this.vaultUploader.upload({
            fileName,
            fileSize,
            filePath: mediaData,
            caption: `LB Vault: ${title}\nOrigem: ${chatTitle}${hashtagStr ? `\n\n${hashtagStr}` : ""}`,
          }),
          25 * 60_000,
          "Timeout ao enviar para Vault (25min)"
        );

        try { fs.unlinkSync(mediaData); } catch {}

        // Validação 1: Arquivo DEVE ter pelo menos 1 foto
        const hasPhotos = matchedPhotos.length > 0;
        if (!hasPhotos) {
          await updateJob("failed", "Arquivo rejeitado: nenhuma foto associada");
          console.log(`[Core] ⚠️  "${fileName}" rejeitado - sem fotos`);
          continue;
        }

        // Validação 2: Calcular hash do arquivo para detectar duplicatas
        await updateJob("indexing");
        const fileBuffer = fs.readFileSync(mediaData);
        const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        // Verificar se arquivo com mesmo hash já existe
        const { data: existing } = await this.supabase
          .from("telegram_indexed_stls")
          .select("id, file_name")
          .eq("file_hash", fileHash)
          .limit(1)
          .maybeSingle();

        if (existing) {
          await updateJob("failed", `Duplicata do arquivo "${existing.file_name}"`);
          console.log(`[Core] 🔄 "${fileName}" é duplicata de "${existing.file_name}"`);
          continue;
        }

        const thumbnail_url = matchedPhotos[0];

        const { error: insertErr } = await this.supabase.from("telegram_indexed_stls").insert({
          title,
          description: `Modelo 3D "${fileName}" indexado automaticamente do Telegram.`,
          telegram_group_id: chatId,
          telegram_group_name: chatTitle,
          telegram_message_id: sentId,
          file_name: fileName,
          file_size_bytes: fileSize,
          file_hash: fileHash,
          tags,
          thumbnail_url,
          photos: matchedPhotos,
          printer_type: printerType,
        });

        if (insertErr) {
          await updateJob("failed", insertErr.message);
        } else {
          await updateJob("completed");
          console.log(`[Core] ✅ "${fileName}" indexado com sucesso!`);
        }
      } catch (e: any) {
        console.error(`[Core] Erro ao processar doc: ${e.message}`);
        await updateJob("failed", e.message);
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
      }
    }
  }
}
