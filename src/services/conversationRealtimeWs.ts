import { type Server as HttpServer, type IncomingMessage } from 'http';
import { ChannelType, UserRole } from '@prisma/client';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '../prisma.js';
import { verifyToken } from '../utils/jwt.js';
import { getLatestRealtimeCursor, readRealtimeSync } from './conversationRealtimeEvents.js';
import { subscribeConversationStream, type ConversationStreamEvent } from './conversationEventsBus.js';
import { hasPermission, normalizeRole } from './accessControl.js';

const DEFAULT_HEARTBEAT_MS = 25000;
const DEFAULT_REPLAY_LIMIT = 300;
const SUBSCRIBE_TIMEOUT_MS = 10000;

type ClientSubscribeMessage = {
  type: 'subscribe';
  payload?: {
    authToken?: unknown;
    channel?: unknown;
    cursor?: unknown;
  };
};

type ServerMessage =
  | {
      type: 'ready';
      payload: {
        salonId: number;
        channel: ChannelType | null;
        latestCursor: number;
        serverTime: string;
      };
    }
  | {
      type: 'conversation.update';
      payload: ConversationStreamEvent;
    }
  | {
      type: 'heartbeat';
      payload: {
        latestCursor: number;
        serverTime: string;
      };
    }
  | {
      type: 'sync_required';
      payload: {
        latestCursor: number;
        reason: 'gap';
      };
    }
  | {
      type: 'error';
      payload: {
        message: string;
        code?: string;
      };
    };

type AuthenticatedSocketUser = {
  userId: number;
  membershipId: number;
  salonId: number;
  role: UserRole;
};

function getHeartbeatMs(): number {
  const raw = Number(process.env.REALTIME_WS_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);
  if (!Number.isInteger(raw) || raw < 1000) return DEFAULT_HEARTBEAT_MS;
  return raw;
}

function getReplayLimit(): number {
  const raw = Number(process.env.REALTIME_REPLAY_LIMIT || DEFAULT_REPLAY_LIMIT);
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_REPLAY_LIMIT;
  return Math.min(raw, 500);
}

function toSafeCursor(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

function asInboundChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') {
    return normalized as ChannelType;
  }
  return null;
}

function sendJson(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

async function authenticateSocketUser(authToken: string): Promise<AuthenticatedSocketUser | null> {
  const payload = verifyToken(authToken);
  if (!payload) return null;

  const membership = await prisma.salonMembership.findUnique({
    where: { id: Number(payload.membershipId || 0) },
    include: {
      identity: { select: { isActive: true } },
    },
  });

  if (!membership || !membership.isActive || !membership.identity.isActive) {
    return null;
  }

  const tokenSalonId = payload.salonId;
  if (!tokenSalonId || tokenSalonId !== membership.salonId) {
    return null;
  }

  const resolvedRole = normalizeRole(membership.role);
  const hasConversationPermission = await hasPermission({
    salonId: membership.salonId,
    membershipId: membership.id,
    role: resolvedRole,
    permissionKey: 'conversations.manage',
  });

  if (!hasConversationPermission) {
    return null;
  }

  return {
    userId: Number(membership.legacySalonUserId || payload.userId),
    membershipId: membership.id,
    salonId: membership.salonId,
    role: resolvedRole,
  };
}

async function handleSubscribe(ws: WebSocket, incoming: ClientSubscribeMessage): Promise<void> {
  const authToken =
    typeof incoming.payload?.authToken === 'string' ? incoming.payload.authToken.trim() : '';

  if (!authToken) {
    sendJson(ws, { type: 'error', payload: { message: 'authToken is required.', code: 'AUTH_REQUIRED' } });
    ws.close(4401, 'Unauthorized');
    return;
  }

  const user = await authenticateSocketUser(authToken);
  if (!user) {
    sendJson(ws, { type: 'error', payload: { message: 'Unauthorized.', code: 'UNAUTHORIZED' } });
    ws.close(4401, 'Unauthorized');
    return;
  }

  const channelFilter =
    incoming.payload?.channel === undefined || incoming.payload?.channel === null
      ? null
      : asInboundChannel(incoming.payload.channel);

  if (incoming.payload?.channel !== undefined && incoming.payload?.channel !== null && !channelFilter) {
    sendJson(ws, { type: 'error', payload: { message: 'channel must be INSTAGRAM or WHATSAPP.', code: 'BAD_CHANNEL' } });
    ws.close(4400, 'Bad channel');
    return;
  }

  let latestCursor = 0;
  const replay = await readRealtimeSync({
    salonId: user.salonId,
    channel: channelFilter,
    since: toSafeCursor(incoming.payload?.cursor),
    limit: getReplayLimit(),
  });

  latestCursor = replay.latestCursor;

  if (replay.requiresFullRefresh || replay.hasGap) {
    sendJson(ws, {
      type: 'sync_required',
      payload: { latestCursor: replay.latestCursor, reason: 'gap' },
    });
  } else {
    for (const event of replay.events) {
      latestCursor = Math.max(latestCursor, event.cursor);
      sendJson(ws, {
        type: 'conversation.update',
        payload: event,
      });
    }
  }

  const currentLatest = await getLatestRealtimeCursor({
    salonId: user.salonId,
    channel: channelFilter,
  });
  latestCursor = Math.max(latestCursor, currentLatest);

  sendJson(ws, {
    type: 'ready',
    payload: {
      salonId: user.salonId,
      channel: channelFilter,
      latestCursor,
      serverTime: new Date().toISOString(),
    },
  });

  const unsubscribe = subscribeConversationStream(user.salonId, (event) => {
    if (channelFilter && event.channel !== channelFilter) return;
    latestCursor = Math.max(latestCursor, event.cursor);
    sendJson(ws, {
      type: 'conversation.update',
      payload: event,
    });
  });

  const heartbeat = setInterval(() => {
    sendJson(ws, {
      type: 'heartbeat',
      payload: {
        latestCursor,
        serverTime: new Date().toISOString(),
      },
    });
  }, getHeartbeatMs());

  ws.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function onWsConnection(ws: WebSocket, _request: IncomingMessage): void {
  let subscribed = false;
  const subscribeTimeout = setTimeout(() => {
    if (!subscribed) {
      sendJson(ws, { type: 'error', payload: { message: 'subscribe message timeout.', code: 'SUBSCRIBE_TIMEOUT' } });
      ws.close(4408, 'Subscribe timeout');
    }
  }, SUBSCRIBE_TIMEOUT_MS);

  ws.on('message', async (raw) => {
    if (subscribed) return;

    let parsed: ClientSubscribeMessage | null = null;
    try {
      parsed = JSON.parse(raw.toString()) as ClientSubscribeMessage;
    } catch {
      sendJson(ws, { type: 'error', payload: { message: 'Invalid JSON payload.', code: 'BAD_JSON' } });
      ws.close(4400, 'Invalid JSON');
      return;
    }

    if (!parsed || parsed.type !== 'subscribe') {
      sendJson(ws, { type: 'error', payload: { message: 'First message must be subscribe.', code: 'BAD_PROTOCOL' } });
      ws.close(4400, 'Bad protocol');
      return;
    }

    subscribed = true;
    clearTimeout(subscribeTimeout);

    try {
      await handleSubscribe(ws, parsed);
    } catch (error) {
      console.error('Conversation realtime websocket subscribe error:', error);
      sendJson(ws, { type: 'error', payload: { message: 'Internal server error.', code: 'INTERNAL' } });
      ws.close(1011, 'Internal error');
    }
  });

  ws.on('close', () => {
    clearTimeout(subscribeTimeout);
  });
}

export function initConversationRealtimeWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://localhost');
      if (requestUrl.pathname !== '/api/admin/conversations/ws') {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    onWsConnection(ws, request);
  });

  console.log('[conversation-realtime-ws] websocket server initialized at /api/admin/conversations/ws');
}
