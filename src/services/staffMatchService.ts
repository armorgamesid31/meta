// Staff ↔ membership eşleştirme yardımcısı.
//
// Sorun: aynı kişi önce "manuel uzman" (Staff, membershipId=null) olarak
// eklenip sonra kendi ekip-üyesi hesabını açınca, davet/kayıt yolları mevcut
// orphan Staff'ı aramadan İKİNCİ bir Staff yaratıyordu → çift kayıt. Bu modül,
// tüm davet/kayıt/kabul yollarının çağırdığı TEK kaynak: bir salonda
// "hesapsız" (orphan) uzmanlardan, katılan kişiyle aynı olma ihtimali yüksek
// olanları telefon (güçlü) ve/veya normalize isim (zayıf) ile bulur.
//
// Güvenlik ilkesi: YANLIŞ-BAĞLAMA (iki ayrı kişiyi birleştirmek) çift kayıttan
// beterdir (randevu/komisyon geçmişi yanlış kişiye gider, geri alınması zor).
// Bu yüzden otomatik birleştirme yalnız TEK kesin adayda yapılır; çoklu/
// belirsiz durum çağırana bırakılır (owner onayı / yeni kayıt).

import type { Prisma, PrismaClient, Staff } from '@prisma/client';
import { canonicalPhoneDigits, resolveRegion } from './phoneValidation.js';

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Bir salon içinde isim eşitliği için uzman adını normalize eder (TR-duyarlı
 * küçük harf + boşluk sadeleştirme). SAKLAMA/GÖSTERİM için DEĞİL, yalnız kıyas.
 */
export function normalizeStaffNameKey(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ');
}

export type OrphanStaffMatch = {
  /** Telefon (canonical) eşleşen orphan'lar — güçlü sinyal. */
  byPhone: Staff[];
  /** Yalnız normalize-isim eşleşen orphan'lar (telefon eşleşmeyenler) — zayıf. */
  byNameOnly: Staff[];
};

export type MatchWho = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** Salon ülke kodu (telefon canonicalization region'ı için; yoksa TR). */
  countryCode?: string | null;
};

/**
 * Salonda `membershipId=null` (hesaba bağlı olmayan) + aktif Staff'lar arasında,
 * verilen kişiyle eşleşen adayları döndürür. Telefon eşleşmesi (canonical)
 * öncelikli; telefon eşleşmeyenlerden normalize-isim eşleşenler ayrı listede.
 */
export async function findOrphanStaffCandidates(
  db: Db,
  salonId: number,
  who: MatchWho,
): Promise<OrphanStaffMatch> {
  const orphans = await db.staff.findMany({
    where: { salonId, membershipId: null, isActive: true },
  });
  if (orphans.length === 0) return { byPhone: [], byNameOnly: [] };

  const region = resolveRegion(who.countryCode);
  const targetPhone = who.phone ? canonicalPhoneDigits(who.phone, region) : '';
  const targetName = normalizeStaffNameKey(
    who.displayName || [who.firstName, who.lastName].filter(Boolean).join(' '),
  );

  const byPhone: Staff[] = [];
  const byNameOnly: Staff[] = [];
  for (const s of orphans) {
    const sPhone = s.phone ? canonicalPhoneDigits(s.phone, region) : '';
    const phoneMatch = Boolean(targetPhone && sPhone && targetPhone === sPhone);
    if (phoneMatch) {
      byPhone.push(s);
      continue;
    }
    const nameMatch = Boolean(targetName && normalizeStaffNameKey(s.name) === targetName);
    if (nameMatch) byNameOnly.push(s);
  }
  return { byPhone, byNameOnly };
}

/**
 * Otomatik bağlanabilecek TEK kesin adayı çözer; belirsiz/yok ise null.
 * Kural: tam 1 telefon eşleşmesi → o. Değilse tam 1 isim eşleşmesi → o.
 * Birden çok telefon adayı (nadir) VEYA birden çok isim adayı → null
 * (çağıran owner onayına düşürür ya da yeni kayıt açar). Asla tahmin etme.
 */
export function resolveAutoBindOrphan(match: OrphanStaffMatch): Staff | null {
  if (match.byPhone.length === 1) return match.byPhone[0];
  if (match.byPhone.length > 1) return null; // belirsiz telefon → owner onayı
  if (match.byNameOnly.length === 1) return match.byNameOnly[0];
  return null;
}

/** Toplam aday sayısı (UI'ya "şu kadar olası eşleşme" demek / 409 kararı için). */
export function totalCandidates(match: OrphanStaffMatch): number {
  return match.byPhone.length + match.byNameOnly.length;
}
