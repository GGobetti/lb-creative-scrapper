import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";

export interface VaultUploadOptions {
  fileName: string;
  fileSize: number;
  caption: string;
  filePath: string;
}

export class VaultUploader {
  constructor(private client: TelegramClient, private vaultChannelId: string) {}

  async upload(options: VaultUploadOptions): Promise<number> {
    const vaultEntity = await this.client.getEntity(this.vaultChannelId);
    const customFile = new CustomFile(options.fileName, options.fileSize, options.filePath);

    const sent = await this.client.sendFile(vaultEntity, {
      file: customFile,
      caption: options.caption,
    });

    return sent.id;
  }
}
