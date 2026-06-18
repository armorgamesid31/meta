import { prisma } from '../prisma.js';

export type PricingGender = 'female' | 'male' | 'other';

export type PricingItem = {
  serviceId: number;
  gender?: PricingGender | string | null;
  staffId?: number | null;
};

export type ResolvedPricing = {
  serviceId: number;
  price: number;
  duration: number;
  /** Booking commit'in AppointmentLine.serviceVariantId snapshot'ı için. */
  serviceVariantId: number | null;
  /** Hangi katman kazandı — debug/test için. */
  source: 'staff' | 'variant' | 'base' | 'missing';
};

/**
 * Bir hizmetin MÜŞTERİYE yansıyan etkin fiyat + süresini çözer.
 *
 * Öncelik (en spesifik kazanır) — availability motorundaki süre seçimiyle
 * (chain-builder.calculateServiceDurations) TUTARLI:
 *   1. StaffService(staffId, gender)        — uzman + cinsiyet (en spesifik)
 *   2. StaffService(staffId, herhangi)      — uzmanın genel satırı
 *   3. ServiceVariant(gender)               — hizmet seviyesi cinsiyet override'ı
 *   4. Service base price/duration
 *
 * staffId yoksa (katalog / sepet henüz uzman seçilmemiş) 1-2 atlanır → variant/base.
 * gender yoksa staff(any) ya da base'e düşülür (variant gender ister).
 *
 * NOT (düzeltme öncesi durum): variant.price ve staffService.price hiçbir
 * müşteri-yolunda (katalog/sepet/commit) kullanılmıyordu; hepsi base Service.price
 * yazıyordu. Bu resolver o boşluğu kapatır — tek kaynak.
 */
export async function resolveServicePricing(salonId: number, items: PricingItem[]): Promise<ResolvedPricing[]> {
  const serviceIds = [...new Set(items.map((i) => Number(i.serviceId)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!serviceIds.length) return items.map((i) => ({ serviceId: Number(i.serviceId), price: 0, duration: 0, serviceVariantId: null, source: 'missing' }));

  const [services, variants, staffServices] = await Promise.all([
    prisma.service.findMany({ where: { salonId, id: { in: serviceIds } }, select: { id: true, price: true, duration: true } }),
    prisma.serviceVariant.findMany({ where: { serviceId: { in: serviceIds }, isActive: true }, select: { id: true, serviceId: true, gender: true, price: true, duration: true } }),
    prisma.staffService.findMany({ where: { serviceId: { in: serviceIds }, isactive: true, Staff: { salonId } }, select: { staffId: true, serviceId: true, gender: true, price: true, duration: true }, orderBy: { id: 'asc' } }),
  ]);

  const baseById = new Map(services.map((s) => [Number(s.id), s]));
  const variantByKey = new Map(variants.map((v) => [`${v.serviceId}:${v.gender}`, v]));
  const ssByKey = new Map(staffServices.map((s) => [`${s.staffId}:${s.serviceId}:${s.gender}`, s]));
  const ssAnyByStaffService = new Map<string, (typeof staffServices)[number]>();
  for (const s of staffServices) {
    const k = `${s.staffId}:${s.serviceId}`;
    if (!ssAnyByStaffService.has(k)) ssAnyByStaffService.set(k, s);
  }

  return items.map((it) => {
    const serviceId = Number(it.serviceId);
    const base = baseById.get(serviceId);
    if (!base) return { serviceId, price: 0, duration: 0, serviceVariantId: null, source: 'missing' };
    const g = it.gender ? String(it.gender) : null;
    const staffId = it.staffId && Number.isInteger(Number(it.staffId)) ? Number(it.staffId) : null;

    // 1 + 2: StaffService (uzman seçiliyse)
    if (staffId) {
      const ss = (g ? ssByKey.get(`${staffId}:${serviceId}:${g}`) : undefined) || ssAnyByStaffService.get(`${staffId}:${serviceId}`);
      if (ss) return { serviceId, price: Number(ss.price), duration: Number(ss.duration), serviceVariantId: null, source: 'staff' };
    }
    // 3: ServiceVariant (cinsiyet)
    if (g) {
      const v = variantByKey.get(`${serviceId}:${g}`);
      if (v) return { serviceId, price: Number(v.price), duration: Number(v.duration), serviceVariantId: v.id, source: 'variant' };
    }
    // 4: base
    return { serviceId, price: Number(base.price), duration: Number(base.duration), serviceVariantId: null, source: 'base' };
  });
}
