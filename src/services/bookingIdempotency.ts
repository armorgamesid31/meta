import { prisma } from '../prisma.js';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 saat

export type CachedBookingResponse = {
  status: number;
  body: any;
};

/**
 * Aynı idempotency key ile daha önce başarılı commit yapılmış mı diye
 * kontrol eder. Bulunursa cache'lenmiş appointment'lar ile commit'in
 * orijinal response body'sini yeniden üretir; bulunmazsa null döner.
 *
 * Salon mismatch durumunda 409 yerine null döndürürüz — caller
 * normal commit yolunu izler, yine de mevcut anahtara INSERT denenirse
 * primary-key violation alır.
 */
export async function findCachedBookingByIdempotencyKey(input: {
  salonId: number;
  idempotencyKey: string;
}): Promise<CachedBookingResponse | null> {
  const existing = await prisma.bookingIdempotencyKey.findUnique({
    where: { key: input.idempotencyKey },
  });
  if (!existing) return null;
  if (existing.salonId !== input.salonId) return null;
  if (existing.expiresAt <= new Date()) return null;

  const appointmentIds = Array.isArray(existing.appointmentIds)
    ? (existing.appointmentIds as unknown as number[]).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (!appointmentIds.length) return null;

  return {
    status: 201,
    body: {
      data: {
        appointments: appointmentIds.map((id) => ({ id })),
        status: 'BOOKED',
        replayed: true,
      },
    },
  };
}

/**
 * Başarılı commit sonrası idempotency anahtarını cache'ler. Aynı anahtar
 * tekrar gelirse [[findCachedBookingByIdempotencyKey]] mevcut appointment
 * id'leri döner; yeni randevu yaratılmaz.
 *
 * Race: paralel iki commit aynı key'i kullanırsa ikisi de upsert
 * çalıştırır — sonuncusu kazanır. Pratik açıdan UI'da çift tıklama tek
 * client'tır, paralel race ihtimal düşük.
 */
export async function cacheBookingForIdempotencyKey(input: {
  salonId: number;
  idempotencyKey: string;
  appointmentIds: number[];
  ttlSeconds?: number;
}): Promise<void> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await prisma.bookingIdempotencyKey.upsert({
    where: { key: input.idempotencyKey },
    create: {
      key: input.idempotencyKey,
      salonId: input.salonId,
      appointmentIds: input.appointmentIds as any,
      expiresAt,
    },
    update: {
      appointmentIds: input.appointmentIds as any,
      expiresAt,
    },
  });
}
