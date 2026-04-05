import { App, ServiceAccount, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Message } from 'firebase-admin/messaging';

export const ANDROID_PUSH_CHANNEL_ID = 'kedy_general_notifications';
export const ANDROID_PUSH_CHANNEL_APPOINTMENT_ID = 'kedy_appointment_notifications';
export const ANDROID_PUSH_CHANNEL_BOOKING_CHANGE_ID = 'kedy_booking_change_notifications';
export const ANDROID_PUSH_CHANNEL_REPORT_ID = 'kedy_report_notifications';
export const ANDROID_PUSH_ICON_NAME = 'ic_stat_kedy_notification';

export type PushProviderSource = 'BASE64' | 'JSON' | 'NONE';
export type PushDeliveryStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface PushProviderStatus {
  configured: boolean;
  source: PushProviderSource;
  error: string | null;
}

export interface PushMessageInput {
  deliveryId: number;
  tokenId: number;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  androidChannelId?: string;
}

export interface PushSendResult {
  deliveryId: number;
  tokenId: number;
  status: PushDeliveryStatus;
  providerMessageId: string | null;
  failureReason: string | null;
  deactivateToken: boolean;
}

const FIREBASE_APP_NAME = 'kedy-mobile-push';
const PERMANENT_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function parseJsonValue<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadServiceAccount(): {
  serviceAccount: ServiceAccount | null;
  source: PushProviderSource;
  error: string | null;
} {
  const base64Value = String(process.env.FCM_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (base64Value) {
    try {
      const decoded = Buffer.from(base64Value, 'base64').toString('utf8');
      const parsed = parseJsonValue<ServiceAccount>(decoded);
      if (!parsed) {
        return {
          serviceAccount: null,
          source: 'BASE64',
          error: 'FCM_SERVICE_ACCOUNT_BASE64 is not valid base64-encoded JSON.',
        };
      }
      return {
        serviceAccount: parsed,
        source: 'BASE64',
        error: null,
      };
    } catch (error) {
      return {
        serviceAccount: null,
        source: 'BASE64',
        error: error instanceof Error ? error.message : 'Unknown base64 decode error.',
      };
    }
  }

  const jsonValue = String(process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (jsonValue) {
    const parsed = parseJsonValue<ServiceAccount>(jsonValue);
    if (!parsed) {
      return {
        serviceAccount: null,
        source: 'JSON',
        error: 'FCM_SERVICE_ACCOUNT_JSON is not valid JSON.',
      };
    }
    return {
      serviceAccount: parsed,
      source: 'JSON',
      error: null,
    };
  }

  return {
    serviceAccount: null,
    source: 'NONE',
    error: null,
  };
}

function getFirebaseApp(): { app: App | null; status: PushProviderStatus } {
  const loaded = loadServiceAccount();
  if (!loaded.serviceAccount) {
    return {
      app: null,
      status: {
        configured: false,
        source: loaded.source,
        error: loaded.error,
      },
    };
  }

  try {
    const app = getApps().some((item) => item.name === FIREBASE_APP_NAME)
      ? getApp(FIREBASE_APP_NAME)
      : initializeApp(
          {
            credential: cert(loaded.serviceAccount),
          },
          FIREBASE_APP_NAME,
        );

    return {
      app,
      status: {
        configured: true,
        source: loaded.source,
        error: null,
      },
    };
  } catch (error) {
    return {
      app: null,
      status: {
        configured: false,
        source: loaded.source,
        error: error instanceof Error ? error.message : 'Unknown Firebase initialization error.',
      },
    };
  }
}

function toDataPayload(data: Record<string, unknown>): Record<string, string> {
  const payload: Record<string, string> = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (!key || value === undefined || value === null) continue;

    if (typeof value === 'string') {
      payload[key] = value;
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      payload[key] = String(value);
      continue;
    }

    payload[key] = JSON.stringify(value);
  }

  return payload;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toFailureReason(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'unknown_push_error';
  }

  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
    return `${candidate.code}: ${candidate.message}`;
  }
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  if (typeof candidate.message === 'string') {
    return candidate.message;
  }
  return 'unknown_push_error';
}

function shouldDeactivateToken(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : '';
  return PERMANENT_TOKEN_ERRORS.has(code);
}

function resolveAndroidSound(channelId: string): string {
  if (channelId === ANDROID_PUSH_CHANNEL_APPOINTMENT_ID) return 'new_appointment';
  if (channelId === ANDROID_PUSH_CHANNEL_BOOKING_CHANGE_ID) return 'booking_changed_canceled';
  if (channelId === ANDROID_PUSH_CHANNEL_REPORT_ID) return 'report';
  return 'default';
}

export function getPushProviderStatus(): PushProviderStatus {
  return getFirebaseApp().status;
}

export async function sendPushMessages(inputs: PushMessageInput[]): Promise<{
  provider: PushProviderStatus;
  results: PushSendResult[];
}> {
  const { app, status } = getFirebaseApp();

  if (!inputs.length) {
    return {
      provider: status,
      results: [],
    };
  }

  if (!app) {
    const fallbackStatus: PushDeliveryStatus = status.source === 'NONE' ? 'SKIPPED' : 'FAILED';
    const fallbackReason =
      status.source === 'NONE'
        ? 'push_provider_not_configured'
        : status.error || 'push_provider_initialization_failed';

    return {
      provider: status,
      results: inputs.map((input) => ({
        deliveryId: input.deliveryId,
        tokenId: input.tokenId,
        status: fallbackStatus,
        providerMessageId: null,
        failureReason: fallbackReason,
        deactivateToken: false,
      })),
    };
  }

  const messaging = getMessaging(app);
  const results: PushSendResult[] = [];

  for (const chunk of chunkItems(inputs, 500)) {
    const messages: Message[] = chunk.map((input) => {
      const channelId = input.androidChannelId || ANDROID_PUSH_CHANNEL_ID;
      return {
        token: input.token,
        notification: {
          title: input.title,
          body: input.body,
        },
        data: toDataPayload(input.data),
        android: {
          priority: 'high',
          notification: {
            channelId,
            icon: ANDROID_PUSH_ICON_NAME,
            sound: resolveAndroidSound(channelId),
          },
        },
      };
    });

    try {
      const batchResponse = await messaging.sendEach(messages);
      batchResponse.responses.forEach((response, index) => {
        const item = chunk[index];

        if (response.success) {
          results.push({
            deliveryId: item.deliveryId,
            tokenId: item.tokenId,
            status: 'SENT',
            providerMessageId: response.messageId || null,
            failureReason: null,
            deactivateToken: false,
          });
          return;
        }

        results.push({
          deliveryId: item.deliveryId,
          tokenId: item.tokenId,
          status: 'FAILED',
          providerMessageId: null,
          failureReason: toFailureReason(response.error),
          deactivateToken: shouldDeactivateToken(response.error),
        });
      });
    } catch (error) {
      const failureReason = toFailureReason(error);
      for (const item of chunk) {
        results.push({
          deliveryId: item.deliveryId,
          tokenId: item.tokenId,
          status: 'FAILED',
          providerMessageId: null,
          failureReason,
          deactivateToken: false,
        });
      }
    }
  }

  return {
    provider: status,
    results,
  };
}
