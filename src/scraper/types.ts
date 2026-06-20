export interface BufferedMessage {
  message: any;
  type: "document" | "photo";
}

export interface ChatBuffer {
  chatId: string;
  chatTitle: string;
  senderId?: string;
  messages: BufferedMessage[];
  timeoutId: NodeJS.Timeout;
}

export interface ScraperJob {
  fileName: string;
  fileSize: number;
  chatTitle: string;
  photos: string[];
  printerType: string;
}

export interface GroupConfig {
  id: string;
  type: "fdm" | "resin";
}
