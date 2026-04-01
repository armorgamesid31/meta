import { ChannelType } from '@prisma/client';

export type ConversationStreamEvent = {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  providerMessageId: string;
  messageType: string;
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
  eventTimestamp: string;
};

type Listener = (event: ConversationStreamEvent) => void;

const listenersBySalon = new Map<number, Set<Listener>>();

export function publishConversationStreamEvent(event: ConversationStreamEvent): void {
  const listeners = listenersBySalon.get(event.salonId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('publishConversationStreamEvent listener error:', error);
    }
  }
}

export function subscribeConversationStream(
  salonId: number,
  listener: Listener,
): () => void {
  const current = listenersBySalon.get(salonId) || new Set<Listener>();
  current.add(listener);
  listenersBySalon.set(salonId, current);

  return () => {
    const bucket = listenersBySalon.get(salonId);
    if (!bucket) return;
    bucket.delete(listener);
    if (bucket.size === 0) {
      listenersBySalon.delete(salonId);
    }
  };
}
