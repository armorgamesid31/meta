// Slot kilidi (SlotLock) ortak helper'ı. Hem booking v2 public flow
// (routes/availability.ts) hem de SaaS admin panel new-appointment flow
// (routes/adminMobile.ts) buradan tüketir; mantık ikiye bölünmesin.

import { prisma } from '../prisma.js';
import { invalidateAvailabilityForSalon } from './availabilityCache.js';

export const SLOT_LOCK_TTL_SECONDS = 120;

export type SlotLockEntry = {
  staffId: number;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
};

export function parseSlotLockEntries(input: unknown): SlotLockEntry[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const parsed: SlotLockEntry[] = [];
  for (const raw of input) {
    const staffId = Number((raw as any)?.staffId);
    const startTimeIso = String((raw as any)?.startTime || '');
    const endTimeIso = String((raw as any)?.endTime || '');
    if (!Number.isInteger(staffId) || staffId <= 0) return null;
    const start = new Date(startTimeIso);
    const end = new Date(endTimeIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (start >= end) return null;
    parsed.push({ staffId, startTime: start.toISOString(), endTime: end.toISOString() });
  }
  return parsed;
}

export function entriesCollideWithLock(
  newEntries: SlotLockEntry[],
  lockEntries: unknown,
): boolean {
  if (!Array.isArray(lockEntries)) return false;
  for (const newEntry of newEntries) {
    const newStart = new Date(newEntry.startTime).getTime();
    const newEnd = new Date(newEntry.endTime).getTime();
    for (const existing of lockEntries as Array<Record<string, unknown>>) {
      if (Number(existing?.staffId) !== newEntry.staffId) continue;
      const existingStart = new Date(String(existing?.startTime || '')).getTime();
      const existingEnd = new Date(String(existing?.endTime || '')).getTime();
      if (Number.isNaN(existingStart) || Number.isNaN(existingEnd)) continue;
      if (newStart < existingEnd && newEnd > existingStart) {
        return true;
      }
    }
  }
  return false;
}

export type CreateSlotLockResult =
  | { ok: true; id: string; expiresAt: Date }
  | { ok: false; code: 'SLOT_TAKEN'; message: string };

export async function createSlotLock(
  salonId: number,
  entries: SlotLockEntry[],
): Promise<CreateSlotLockResult> {
  const result = await prisma.$transaction(async (tx): Promise<CreateSlotLockResult> => {
    const now = new Date();

    for (const entry of entries) {
      const conflict = await tx.appointment.findFirst({
        where: {
          salonId,
          staffId: entry.staffId,
          status: 'BOOKED',
          startTime: { lt: new Date(entry.endTime) },
          endTime: { gt: new Date(entry.startTime) },
        },
        select: { id: true },
      });
      if (conflict) {
        return { ok: false, code: 'SLOT_TAKEN', message: 'Slot is already booked.' } as const;
      }
    }

    const activeLocks = await tx.slotLock.findMany({
      where: { salonId, expiresAt: { gt: now } },
      select: { entries: true },
    });
    for (const lock of activeLocks) {
      if (entriesCollideWithLock(entries, lock.entries)) {
        return { ok: false, code: 'SLOT_TAKEN', message: 'Slot is locked by another customer.' } as const;
      }
    }

    const expiresAt = new Date(Date.now() + SLOT_LOCK_TTL_SECONDS * 1000);
    const created = await tx.slotLock.create({
      data: {
        salonId,
        entries: entries as any,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    return { ok: true, id: created.id, expiresAt: created.expiresAt } as const;
  }, { isolationLevel: 'Serializable' });

  if (result.ok) {
    invalidateAvailabilityForSalon(salonId).catch(() => undefined);
  }
  return result;
}

export async function deleteSlotLock(salonId: number, id: string): Promise<void> {
  await prisma.slotLock.deleteMany({ where: { id, salonId } });
  invalidateAvailabilityForSalon(salonId).catch(() => undefined);
}

/**
 * Extend a still-valid lock's TTL by another window. Used to keep the slot
 * reserved while the customer fills the (now multi-step) registration. Only
 * extends a lock that is OURS and NOT yet expired — never resurrects an expired
 * lock (the slot may already have been taken). Returns ok=false if the lock is
 * gone/expired, so the caller can re-lock or surface "slot taken".
 */
export async function refreshSlotLock(
  salonId: number,
  id: string,
): Promise<{ ok: boolean; expiresAt?: Date }> {
  const now = new Date();
  const expiresAt = new Date(Date.now() + SLOT_LOCK_TTL_SECONDS * 1000);
  const updated = await prisma.slotLock.updateMany({
    where: { id, salonId, expiresAt: { gt: now } },
    data: { expiresAt },
  });
  if (updated.count === 0) return { ok: false };
  return { ok: true, expiresAt };
}

// Commit anında kilidin hâlâ geçerli ve bu salona ait olduğunu doğrula.
// Hatalı/eski lock'ları sessizce yok say: motor zaten BOOKED appointment
// üzerinden re-check yapacak.
export async function consumeSlotLockIfValid(
  salonId: number,
  id: string | null | undefined,
): Promise<boolean> {
  if (!id) return false;
  const lock = await prisma.slotLock.findUnique({
    where: { id },
    select: { id: true, salonId: true, expiresAt: true },
  });
  if (!lock || lock.salonId !== salonId) return false;
  if (lock.expiresAt.getTime() <= Date.now()) {
    await prisma.slotLock.deleteMany({ where: { id } });
    return false;
  }
  await prisma.slotLock.deleteMany({ where: { id } });
  return true;
}
