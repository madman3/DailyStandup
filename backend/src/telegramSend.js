/**
 * Outbound Telegram messages (bot token from env).
 */
export async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("sendTelegramMessage: TELEGRAM_BOT_TOKEN not set");
    return { ok: false, error: "no token" };
  }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
    }),
  });
  const data = await r.json();
  if (!data.ok) {
    console.warn("sendTelegramMessage failed:", data);
  }
  return data.ok ? { ok: true } : { ok: false, error: data };
}
