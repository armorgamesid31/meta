import type { ChannelType } from '@prisma/client';

// conversationKey kanonik biçimi `<CHANNEL>:<raw>` (ör. `WHATSAPP:905312006807`).
// Inbound webhook bu biçimde saklar (channelWebhooks `WHATSAPP:${wa_id}`); ama
// panel bazı aksiyonlarda (magic-link, medya) ÇIPLAK alıcı id'si (`905...`)
// gönderir. Writer'lar bunu normalize etmezse aynı müşteri için ikinci bir
// ConversationState/MessageEvent satırı doğar ve konuşma ikiye bölünür
// (panel bir satırı, mesaj akışı diğerini kullanır). Bu helper'lar tek
// kaynaktan kanonikleştirir.

/** `WHATSAPP:905...` → `905...`; zaten ham ise olduğu gibi döndürür. */
export function extractRawConversationKey(channel: ChannelType, value: string): string {
  const trimmed = (value || '').trim();
  const prefix = `${channel}:`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
}

/** Her zaman `<CHANNEL>:<raw>` döndürür (idempotent — prefix'li gelen aynı kalır). */
export function ensureChannelPrefixedKey(channel: ChannelType, value: string): string {
  const raw = extractRawConversationKey(channel, value);
  return `${channel}:${raw}`;
}
