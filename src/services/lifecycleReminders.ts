// Lifecycle reminder cron — drips milestone-based emails to salons
// in their setup / grace window so they don't quietly hit
// PAYMENT_REQUIRED without ever noticing.
//
// Driven by jobs/index.ts:tickLifecycleReminders every 6h. Each
// salon's lifecycleReminderState JSONB tracks which milestone
// emails have already been sent so the cron doesn't double-send
// even if it ticks past a deadline multiple times.
//
// Milestone schedule (in setup-period days):
//   D7   — mid-setup nudge      ("yarı yolda")
//   D11  — 3 days left for bonus
//   D13  — last day for bonus
//   D14 grace_start (if bonus criteria not met) — covered by D11/D13 +
//        the lifecycle transition itself; no separate email
//   GRACE D17 — 4 days left of grace
//   GRACE D20 — 1 day left, payment required tomorrow
//   PAYMENT_REQUIRED D0 — account locked, here's how to unlock
//
// Push notifications can be added later in the same loop; SMS is
// expensive so we keep it for the most urgent rung only (D20).

import { SalonAccessStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  sendLifecycleReminderEmail,
  isEmailConfigured,
} from './emailService.js';

const SETUP_CENTER_URL =
  (process.env.PUBLIC_APP_URL || 'https://web.kedyapp.com').replace(/\/+$/, '') +
  '/app/setup-center';

type MilestoneKey =
  | 'setup_d7'
  | 'setup_d11'
  | 'setup_d13'
  | 'grace_d17'
  | 'grace_d20'
  | 'payment_required_d0';

interface Milestone {
  key: MilestoneKey;
  subject: string;
  paragraphs: (salonName: string) => string[];
  cta?: { label: string; url: string };
}

const MILESTONES: Record<MilestoneKey, Milestone> = {
  setup_d7: {
    key: 'setup_d7',
    subject: 'Kurulumun yarısındasın — devam et 🚀',
    paragraphs: () => [
      'Kedy hesabını açtın, harika. Şimdi setup-center adımlarını tamamlayıp +30 gün ücretsiz bonusu hak edebilirsin.',
      'Kalan adımlar: WhatsApp/Instagram bağlantısı, ödeme yöntemi ekleme, randevu linkini test etme. Hepsi 10 dakikada biter.',
    ],
    cta: { label: 'Kuruluma Devam Et', url: SETUP_CENTER_URL },
  },
  setup_d11: {
    key: 'setup_d11',
    subject: '3 gün kaldı: +30 gün ücretsiz bonusunu kaçırma',
    paragraphs: () => [
      'Kurulum süren 3 gün içinde bitiyor. Eksik adımları tamamlarsan otomatik olarak +30 gün ücretsiz bonus açılır.',
      'Bonusu kaçırırsan 7 günlük ek süre yine var ama bonus daha avantajlı.',
    ],
    cta: { label: 'Eksikleri Gör', url: SETUP_CENTER_URL },
  },
  setup_d13: {
    key: 'setup_d13',
    subject: 'Son gün: bonus için kurulumu bitirme zamanı',
    paragraphs: () => [
      'Yarın 14 gün doluyor. Eksik adımları bugün tamamlarsan +30 gün ücretsiz bonusu garantilersin.',
      'Bonusu kaçırırsan 7 günlük ek süre tanırız; o sürede ödeme yöntemi eklersen aboneliğin sorunsuz başlar.',
    ],
    cta: { label: 'Son Adımları Bitir', url: SETUP_CENTER_URL },
  },
  grace_d17: {
    key: 'grace_d17',
    subject: '4 gün kaldı: ödeme yöntemi ekle, kullanmaya devam et',
    paragraphs: () => [
      'Kurulum sürenin sonunda bonus için gereken adımlar tamamlanmamıştı. 7 günlük ek sürenin 4 günü kaldı.',
      'Ödeme yöntemi eklediğin an aboneliğin sorunsuz başlar — ilk faturanın kesilmesi için bonus/grace bitimini bekleriz.',
    ],
    cta: { label: 'Ödeme Yöntemi Ekle', url: SETUP_CENTER_URL },
  },
  grace_d20: {
    key: 'grace_d20',
    subject: 'Yarın hesabın kilitlenir — son uyarı',
    paragraphs: () => [
      'Ek süren yarın doluyor. Ödeme yöntemi eklemediğin için hesabın kilitlenecek; randevu yönetimi, WhatsApp/Instagram iletişim ve diğer tüm özellikler erişilemez olacak.',
      'Şimdi 2 dakika ayır — kartını ekle, kesinti yaşamadan devam et.',
    ],
    cta: { label: 'Şimdi Ekle', url: SETUP_CENTER_URL },
  },
  payment_required_d0: {
    key: 'payment_required_d0',
    subject: 'Hesabın kilitli — geri açmak için ödeme yöntemi gerekli',
    paragraphs: () => [
      'Ek süren doldu ve henüz ödeme yöntemi eklemediğin için Kedy hesabın geçici olarak kilitlendi.',
      'Setup-center üzerinden kartını ekleyip aboneliğini başlatınca hesabın anında geri açılır — verilerin, ayarların ve geçmiş randevuların kayıp değil, korunuyor.',
    ],
    cta: { label: 'Hesabı Geri Aç', url: SETUP_CENTER_URL },
  },
};

export interface LifecycleReminderResult {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface ReminderStateMap {
  [key: string]: string; // ISO timestamp
}

function dayDelta(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function pickMilestone(
  salon: {
    setupAccessStatus: SalonAccessStatus;
    setupPeriodStartedAt: Date | null;
    setupGracePeriodEndsAt: Date | null;
  },
  now: Date,
): MilestoneKey | null {
  if (salon.setupAccessStatus === SalonAccessStatus.SETUP_PERIOD) {
    if (!salon.setupPeriodStartedAt) return null;
    const day = dayDelta(salon.setupPeriodStartedAt, now);
    // Pick the most recent milestone the salon has crossed but not
    // yet received. Order matters — we want the latest one because
    // older ones may have been skipped on a cron miss.
    if (day >= 13) return 'setup_d13';
    if (day >= 11) return 'setup_d11';
    if (day >= 7) return 'setup_d7';
    return null;
  }

  if (salon.setupAccessStatus === SalonAccessStatus.GRACE_PERIOD) {
    if (!salon.setupGracePeriodEndsAt) return null;
    const daysLeft = dayDelta(now, salon.setupGracePeriodEndsAt);
    if (daysLeft <= 1) return 'grace_d20';
    if (daysLeft <= 4) return 'grace_d17';
    return null;
  }

  if (salon.setupAccessStatus === SalonAccessStatus.PAYMENT_REQUIRED) {
    return 'payment_required_d0';
  }

  return null;
}

export async function processLifecycleReminders(
  now: Date = new Date(),
): Promise<LifecycleReminderResult> {
  const result: LifecycleReminderResult = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

  if (!isEmailConfigured()) {
    // No SMTP credentials — silently skip rather than spam logs.
    return result;
  }

  // Only salons whose lifecycle is still in motion. ACTIVE_PAID and
  // SUSPENDED never get reminders.
  const salons = await prisma.salon.findMany({
    where: {
      setupAccessStatus: {
        in: [
          SalonAccessStatus.SETUP_PERIOD,
          SalonAccessStatus.GRACE_PERIOD,
          SalonAccessStatus.PAYMENT_REQUIRED,
        ],
      },
    },
    select: {
      id: true,
      name: true,
      setupAccessStatus: true,
      setupPeriodStartedAt: true,
      setupGracePeriodEndsAt: true,
      lifecycleReminderState: true,
      memberships: {
        where: { isActive: true, role: 'OWNER' },
        select: { identity: { select: { email: true } } },
        take: 1,
      },
    },
  });
  result.scanned = salons.length;

  for (const salon of salons) {
    const milestoneKey = pickMilestone(salon, now);
    if (!milestoneKey) {
      result.skipped += 1;
      continue;
    }

    const state = ((salon.lifecycleReminderState as ReminderStateMap | null) ?? {}) as ReminderStateMap;
    if (state[milestoneKey]) {
      // Already sent this milestone — don't double-send even on
      // repeated cron ticks.
      result.skipped += 1;
      continue;
    }

    const ownerEmail = salon.memberships[0]?.identity?.email;
    if (!ownerEmail) {
      result.skipped += 1;
      continue;
    }

    const m = MILESTONES[milestoneKey];
    try {
      await sendLifecycleReminderEmail({
        to: ownerEmail,
        salonName: salon.name,
        subject: m.subject,
        paragraphs: m.paragraphs(salon.name),
        cta: m.cta,
        milestone: milestoneKey,
      });
      await prisma.salon.update({
        where: { id: salon.id },
        data: {
          lifecycleReminderState: { ...state, [milestoneKey]: now.toISOString() },
        },
      });
      result.sent += 1;
    } catch (err) {
      console.error('[lifecycleReminders] send failed', {
        salonId: salon.id,
        milestone: milestoneKey,
        error: (err as Error)?.message,
      });
      result.failed += 1;
    }
  }

  return result;
}
