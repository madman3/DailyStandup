/**
 * Telegram voice-note helpers: fetch the .ogg from Telegram and transcribe it via Gemini.
 *
 * Both helpers take optional dependency-injection hooks so tests can run without
 * touching the network or the real Gemini SDK.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

const TRANSCRIBE_PROMPT =
  "Transcribe this voice message exactly as spoken. Output only the spoken words as plain text — no commentary, no quotes, no formatting.";

/**
 * Download a Telegram voice note as a Node Buffer using getFile + the file CDN.
 *
 * @param {string} fileId — Telegram file_id from `message.voice.file_id`
 * @param {string} token — Bot token (TELEGRAM_BOT_TOKEN)
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function downloadTelegramVoiceBuffer(fileId, token, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!fileId) throw new Error("downloadTelegramVoiceBuffer: fileId required");
  if (!token) throw new Error("downloadTelegramVoiceBuffer: token required");

  const metaResp = await fetchImpl(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const meta = await metaResp.json();
  if (!meta?.ok || !meta?.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(meta)}`);
  }
  const filePath = meta.result.file_path;
  const fileResp = await fetchImpl(
    `https://api.telegram.org/file/bot${token}/${filePath}`
  );
  if (!fileResp.ok) {
    throw new Error(`Telegram file download failed: HTTP ${fileResp.status}`);
  }
  const arrayBuf = await fileResp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Transcribe an audio buffer using Gemini with an inline base64 audio part.
 *
 * @param {Buffer} buffer
 * @param {string} [mimeType] — defaults to "audio/ogg" (Telegram voice notes use Opus/OGG)
 * @param {{ apiKey?: string, modelName?: string, clientFactory?: (apiKey: string) => any }} [opts]
 * @returns {Promise<string>} trimmed transcript
 */
export async function transcribeVoiceBufferWithGemini(buffer, mimeType, opts = {}) {
  if (!buffer || !buffer.length) {
    throw new Error("transcribeVoiceBufferWithGemini: empty audio buffer");
  }
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const modelName =
    opts.modelName ?? process.env.GEMINI_MODEL?.trim() ?? "gemini-2.5-flash";
  const genAI = opts.clientFactory
    ? opts.clientFactory(apiKey)
    : new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([
    { text: TRANSCRIBE_PROMPT },
    {
      inlineData: {
        mimeType: mimeType || "audio/ogg",
        data: buffer.toString("base64"),
      },
    },
  ]);
  const text = result?.response?.text?.() ?? "";
  return String(text).trim();
}
