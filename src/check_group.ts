import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import dotenv from "dotenv";

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
const apiHash = process.env.TELEGRAM_API_HASH || "";
const sessionString = process.env.TELEGRAM_SESSION || "";

const stringSession = new StringSession(sessionString);

async function main() {
  console.log("Connecting to Telegram...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log("Connected successfully!");
  console.log("Loading dialogs to populate entity cache...");
  await client.getDialogs();

  const targetGroupsRaw = process.env.TARGET_GROUPS || "";
  const targetGroups = targetGroupsRaw.split(",").map(g => g.trim()).filter(Boolean);
  const targetGroup = targetGroups[0] || "LB Creative STls";

  console.log(`Searching messages in group: "${targetGroup}"...`);
  try {
    const chat = await client.getEntity(targetGroup);
    const messages = await client.getMessages(chat, { limit: 10 });
    
    console.log("--- LATEST MESSAGES ---");
    for (const msg of messages) {
      let mediaType = "none";
      let fileName = "";
      
      if (msg.media) {
        mediaType = msg.media.className || "unknown";
        if ('document' in msg.media) {
          const doc = (msg.media as any).document;
          const attr = doc.attributes?.find((a: any) => 'fileName' in a);
          if (attr) fileName = attr.fileName;
        }
      }
      
      console.log(`[ID: ${msg.id}] Date: ${msg.date} | Text: "${msg.message || ""}" | Media: ${mediaType} | File: ${fileName}`);
    }
  } catch (err: any) {
    console.error("Error retrieving messages:", err.message);
  }

  await client.disconnect();
}

main();
