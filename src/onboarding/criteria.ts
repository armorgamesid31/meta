/**
 * Declarative criteria registry for the Setup Center / bonus flow.
 *
 * Each criterion is a small async predicate run against a per-salon
 * aggregate context (see progress.ts:loadCriteriaContext). The
 * lifecycle service iterates the relevant set and decides whether the
 * salon is bonus-eligible.
 *
 * Why declarative instead of inline conditions?
 *   - The UI mirrors this exact list (label, hint, current/required
 *     values) without hard-coding strings on the frontend.
 *   - New campaigns can swap the criteria set without touching the
 *     service code.
 *   - Tests can assert on `key` strings, not implementation details.
 *
 * IMPORTANT: do NOT duplicate fields that the 10-step owner wizard
 * already makes mandatory (salonName, slug, address, phone, working
 * hours, communication tone). Those are guaranteed-present by the time
 * the salon reaches the Setup Center. The criteria below cover only
 * the SKIP-able wizard steps (logo, gallery, services) plus the
 * post-wizard "make this thing actually usable" tasks.
 */

import type { Salon, SalonChannelBinding } from '@prisma/client';
import type { AcquisitionOffer } from './offers.js';

export type CriteriaSetKey = 'STANDARD_V1_BONUS';

export interface CriteriaContext {
  salon: Pick<
    Salon,
    | 'id'
    | 'logoUrl'
    | 'channelOnboardingState'
    | 'paymentMethodOnFile'
    | 'bookingLinkTestedAt'
    | 'appointmentImportDecision'
    | 'onboardingStatus'
  >;
  serviceCount: number;
  staffCount: number;
  staffServiceCount: number;
  appointmentCount: number;
  activeChannelBindings: SalonChannelBinding[];
  offer: AcquisitionOffer;
}

export interface CriterionEvaluation {
  /** Stable, machine-readable key. Persisted in events; never reuse. */
  key: string;
  /** UI label (Turkish, dashboard-ready). */
  label: string;
  /** Optional helper sentence shown under the label. */
  hint?: string;
  /** Is this criterion satisfied right now? */
  completed: boolean;
  /** Optional progress signal ("3/5"). */
  currentValue?: number;
  requiredValue?: number;
  /**
   * UX hint for the frontend: which screen should we deeplink to from
   * this criterion's row? Maps to admin app routes.
   */
  cta?:
    | 'services'
    | 'staff'
    | 'staff_services'
    | 'profile_logo'
    | 'booking_link'
    | 'channels'
    | 'import_wizard'
    | 'appointments'
    | 'billing';
}

interface CriterionDefinition {
  key: string;
  label: string;
  hint?: string;
  cta?: CriterionEvaluation['cta'];
  /**
   * Returns the evaluation. `requiredValue/currentValue` are optional
   * extras for "3/5" style UI; `completed` is the single source of
   * truth for eligibility math.
   */
  evaluate: (
    ctx: CriteriaContext,
  ) => Pick<CriterionEvaluation, 'completed' | 'currentValue' | 'requiredValue'>;
  /**
   * Predicate: should this criterion be skipped entirely for the given
   * offer? Used to drop `payment_method_on_file` when an offer doesn't
   * require it.
   */
  appliesTo?: (offer: AcquisitionOffer) => boolean;
}

const STANDARD_V1_BONUS_DEFINITIONS: CriterionDefinition[] = [
  {
    key: 'min_5_services',
    label: 'En az 5 hizmet ekle',
    hint: 'Müşterilerinin online randevu alabilmesi için hizmet listene en az 5 hizmet eklemelisin.',
    cta: 'services',
    evaluate: (ctx) => ({
      completed: ctx.serviceCount >= 5,
      currentValue: ctx.serviceCount,
      requiredValue: 5,
    }),
  },
  {
    key: 'min_1_staff',
    label: 'En az 1 çalışan ekle',
    hint: 'Tek kişilik salon olsan bile kendi profilini bir çalışan olarak eklemelisin.',
    cta: 'staff',
    evaluate: (ctx) => ({
      completed: ctx.staffCount >= 1,
      currentValue: ctx.staffCount,
      requiredValue: 1,
    }),
  },
  {
    key: 'staff_service_matrix',
    label: 'Çalışan-hizmet eşleşmesi yap',
    hint: 'Hangi çalışanın hangi hizmeti verdiğini belirtmen lazım — yoksa müşteri randevu alamaz.',
    cta: 'staff_services',
    evaluate: (ctx) => ({
      completed: ctx.staffServiceCount >= 1,
      currentValue: ctx.staffServiceCount,
      requiredValue: 1,
    }),
  },
  {
    key: 'logo_uploaded',
    label: 'Salon logosunu yükle',
    hint: 'Booking sayfanda ve WhatsApp mesajlarında görünür. İlk izlenim için kritik.',
    cta: 'profile_logo',
    evaluate: (ctx) => ({ completed: Boolean(ctx.salon.logoUrl) }),
  },
  {
    key: 'appointment_import_decision',
    label: 'Mevcut randevu aktarım kararı ver',
    hint: 'Eski sistemden randevu aktaracaksan bunu işaretle. Yoksa "aktarılacak randevu yok" de.',
    cta: 'import_wizard',
    evaluate: (ctx) => ({
      completed: Boolean(ctx.salon.appointmentImportDecision),
    }),
  },
  {
    key: 'booking_link_tested',
    label: 'Booking linkini test et',
    hint: 'Müşteri gözünden bir kez randevu sayfanı aç ve görüntüle.',
    cta: 'booking_link',
    evaluate: (ctx) => ({ completed: Boolean(ctx.salon.bookingLinkTestedAt) }),
  },
  {
    key: 'first_appointment',
    label: 'En az 1 randevu oluştur',
    hint: 'Test veya gerçek — fark etmez. Salonun gerçek bir randevu akışı görmüş olmalı.',
    cta: 'appointments',
    evaluate: (ctx) => ({
      completed: ctx.appointmentCount >= 1,
      currentValue: ctx.appointmentCount,
      requiredValue: 1,
    }),
  },
  {
    key: 'channel_connected_or_blocked',
    label: 'WhatsApp veya Instagram bağlantısı',
    hint:
      'Yapay zekâ asistanı için kritik. Bağlandı, "doğrulama bekliyor" ya da "hesabım henüz yok" işaretle.',
    cta: 'channels',
    evaluate: (ctx) => {
      const connected = ctx.activeChannelBindings.some((b) => b.isActive);
      if (connected) return { completed: true };
      const raw = ctx.salon.channelOnboardingState as
        | { whatsapp?: { status?: string }; instagram?: { status?: string } }
        | null;
      const wa = raw?.whatsapp?.status;
      const ig = raw?.instagram?.status;
      const BLOCKED = new Set(['pending_verification', 'no_account_yet']);
      const blocked = BLOCKED.has(String(wa)) || BLOCKED.has(String(ig));
      return { completed: blocked };
    },
  },
  {
    key: 'payment_method_on_file',
    label: 'Ödeme yöntemi tanımla',
    hint:
      'Bonus +1 ay aktif kullanım hakkın için kart bilgini eklemen gerekiyor. Ücret bonus bitiminde alınır.',
    cta: 'billing',
    appliesTo: (offer) => offer.requiresPaymentMethodForBonus,
    evaluate: (ctx) => ({ completed: Boolean(ctx.salon.paymentMethodOnFile) }),
  },
];

const REGISTRY: Record<CriteriaSetKey, CriterionDefinition[]> = {
  STANDARD_V1_BONUS: STANDARD_V1_BONUS_DEFINITIONS,
};

export function getCriterionDefinitions(set: CriteriaSetKey): CriterionDefinition[] {
  return REGISTRY[set] || [];
}

/**
 * Evaluate the full criteria set for a salon. Returns one row per
 * criterion (including skipped/N/A criteria filtered out).
 */
export function evaluateCriteria(
  set: CriteriaSetKey,
  ctx: CriteriaContext,
): CriterionEvaluation[] {
  return getCriterionDefinitions(set)
    .filter((def) => (def.appliesTo ? def.appliesTo(ctx.offer) : true))
    .map((def) => {
      const { completed, currentValue, requiredValue } = def.evaluate(ctx);
      return {
        key: def.key,
        label: def.label,
        hint: def.hint,
        cta: def.cta,
        completed,
        currentValue,
        requiredValue,
      };
    });
}

export function isBonusEligible(evaluations: CriterionEvaluation[]): boolean {
  return evaluations.length > 0 && evaluations.every((e) => e.completed);
}

export function computeProgressPercent(evaluations: CriterionEvaluation[]): number {
  if (evaluations.length === 0) return 0;
  const completed = evaluations.filter((e) => e.completed).length;
  return Math.round((completed / evaluations.length) * 100);
}

/**
 * Validation helper for the channel-status endpoint. Mirrors the
 * structure used by `channel_connected_or_blocked` so unknown statuses
 * can't slip in.
 */
export const CHANNEL_STATUS_VALUES = [
  'connected',
  'pending_verification',
  'no_account_yet',
] as const;
export type ChannelStatusValue = (typeof CHANNEL_STATUS_VALUES)[number];

export const APPOINTMENT_IMPORT_DECISIONS = [
  'imported',
  'no_data_to_import',
] as const;
export type AppointmentImportDecision = (typeof APPOINTMENT_IMPORT_DECISIONS)[number];
