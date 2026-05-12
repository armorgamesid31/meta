// Salon-template breakdown: TWO perspectives side by side.
//   A) Meta'nın gözünden (metaStatus + metaCategory bumps)
//   B) Bizim DB submissionState'imiz
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SALON_ID = Number(process.argv[2] || 2);

const rows = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID, templateKey: { not: null } },
  select: {
    templateKey: true, tone: true, submissionState: true,
    metaStatus: true, metaCategory: true, expectedCategory: true,
    rejectionReason: true,
  },
});

const FRIENDLY_NAME = {
  kdy_randevu_hatirlatma_1_gun: '1 Gün Hatırlatma',
  kdy_randevu_hatirlatma_3_gun: '3 Gün Hatırlatma',
  kdy_randevu_hatirlatma_2_saat: '2 Saat Kala',
  kdy_no_show_hatirlatma: 'Gelmeyene Bildirim',
  kdy_waitlist_teklif: 'Bekleme Listesi',
  kdy_memnuniyet_anketi: 'Memnuniyet Anketi',
  kdy_google_maps_yorum: 'Google Yorum',
  kdy_dogum_gunu_kutlamasi: 'Doğum Günü',
  kdy_geri_donus: 'Geri Kazanım',
};
const TONE_ORDER = ['FRIENDLY', 'BALANCED', 'PROFESSIONAL'];
const KEY_ORDER = Object.keys(FRIENDLY_NAME);

// Bucket data
const grouped = {};
for (const r of rows) {
  const k = `${r.templateKey}::${r.tone}`;
  if (!grouped[k]) grouped[k] = {
    total: 0,
    // META perspective — what Meta sees on its end
    metaApproved: 0,
    metaReview: 0,   // metaStatus = PENDING or null (still being reviewed)
    metaRejected: 0,
    metaBumped: 0,   // category changed (either via webhook or detected)
    // OUR DB perspective — what our picker considers usable
    dbActive: 0,         // ACTIVE_VALID (picker'da kullanılabilir)
    dbOutdated: 0,       // user_marked_outdated (bizim pasif kararımız)
    dbCategoryBumped: 0, // CATEGORY_BUMPED state
    dbPoolEx: 0,         // POOL_EXHAUSTED
    dbRejected: 0,       // REJECTED (other reasons)
    dbInProgress: 0,     // SUBMITTED/NOT_QUEUED
  };
  const g = grouped[k];
  g.total++;

  // META side
  const ms = r.metaStatus;
  if (ms === 'APPROVED') g.metaApproved++;
  else if (ms === 'REJECTED') g.metaRejected++;
  else g.metaReview++; // PENDING or null
  // Meta bumped if metaCategory differs from expectedCategory
  if (r.metaCategory && r.expectedCategory && r.metaCategory !== r.expectedCategory) {
    g.metaBumped++;
  }

  // DB side
  const ss = r.submissionState;
  const reason = r.rejectionReason || '';
  if (ss === 'ACTIVE_VALID') g.dbActive++;
  else if (ss === 'CATEGORY_BUMPED') g.dbCategoryBumped++;
  else if (ss === 'POOL_EXHAUSTED' || ss === 'REJECTED') {
    if (reason.startsWith('user_marked_outdated')) g.dbOutdated++;
    else if (ss === 'POOL_EXHAUSTED') g.dbPoolEx++;
    else g.dbRejected++;
  }
  else g.dbInProgress++;
}

console.log(`\nSalon ${SALON_ID} — TABLO A: META PANELİ TARAFINDAN GÖRÜLEN\n`);
console.log('Şablon                Ton           Top  Onaylı  İncelemede  Reddedildi  KategoriBump');
console.log('─'.repeat(95));
let mTotal = 0, mAp = 0, mRev = 0, mRj = 0, mBump = 0;
for (const key of KEY_ORDER) {
  for (const tone of TONE_ORDER) {
    const g = grouped[`${key}::${tone}`];
    if (!g) continue;
    const name = (FRIENDLY_NAME[key] || key).padEnd(20);
    const t = tone.padEnd(12);
    console.log(
      `${name}  ${t} ${String(g.total).padStart(3)}` +
      `  ${String(g.metaApproved).padStart(6)}` +
      `  ${String(g.metaReview).padStart(10)}` +
      `  ${String(g.metaRejected).padStart(10)}` +
      `  ${String(g.metaBumped).padStart(12)}`
    );
    mTotal += g.total; mAp += g.metaApproved; mRev += g.metaReview;
    mRj += g.metaRejected; mBump += g.metaBumped;
  }
}
console.log('─'.repeat(95));
console.log(
  `TOPLAM                              ${String(mTotal).padStart(3)}` +
  `  ${String(mAp).padStart(6)}` +
  `  ${String(mRev).padStart(10)}` +
  `  ${String(mRj).padStart(10)}` +
  `  ${String(mBump).padStart(12)}`
);

console.log(`\nSalon ${SALON_ID} — TABLO B: BİZİM DB STATE'İMİZ (picker davranışı için)\n`);
console.log('Şablon                Ton           Top  Aktif  Outdated  Bump-State  PoolEx  Reddedildi  Devamda');
console.log('─'.repeat(110));
let dTotal=0, dAct=0, dOut=0, dBump=0, dPex=0, dRj=0, dIp=0;
for (const key of KEY_ORDER) {
  for (const tone of TONE_ORDER) {
    const g = grouped[`${key}::${tone}`];
    if (!g) continue;
    const name = (FRIENDLY_NAME[key] || key).padEnd(20);
    const t = tone.padEnd(12);
    console.log(
      `${name}  ${t} ${String(g.total).padStart(3)}` +
      `  ${String(g.dbActive).padStart(5)}` +
      `  ${String(g.dbOutdated).padStart(8)}` +
      `  ${String(g.dbCategoryBumped).padStart(10)}` +
      `  ${String(g.dbPoolEx).padStart(6)}` +
      `  ${String(g.dbRejected).padStart(10)}` +
      `  ${String(g.dbInProgress).padStart(7)}`
    );
    dTotal+=g.total; dAct+=g.dbActive; dOut+=g.dbOutdated;
    dBump+=g.dbCategoryBumped; dPex+=g.dbPoolEx;
    dRj+=g.dbRejected; dIp+=g.dbInProgress;
  }
}
console.log('─'.repeat(110));
console.log(
  `TOPLAM                              ${String(dTotal).padStart(3)}` +
  `  ${String(dAct).padStart(5)}` +
  `  ${String(dOut).padStart(8)}` +
  `  ${String(dBump).padStart(10)}` +
  `  ${String(dPex).padStart(6)}` +
  `  ${String(dRj).padStart(10)}` +
  `  ${String(dIp).padStart(7)}`
);

console.log('\nLejant:');
console.log('TABLO A (Meta paneli):');
console.log('  Onaylı       = metaStatus = APPROVED');
console.log('  İncelemede   = "Değerlendirmede" (PENDING) — Meta hala karar vermedi');
console.log('  Reddedildi   = Meta REJECTED dedi');
console.log('  KategoriBump = Meta kategoriyi değiştirdi (UTILITY→MARKETING)');
console.log('TABLO B (Bizim DB):');
console.log('  Aktif        = picker mesaj göndermek için bunu seçebilir');
console.log('  Outdated     = bizim sync kararımızla pasif (eski body, picker kullanmaz)');
console.log('  Bump-State   = CATEGORY_BUMPED state (picker kullanmaz)');
console.log('  PoolEx       = havuz tüketildi (Meta hala review ediyor olabilir)');
console.log('  Devamda      = SUBMITTED veya NOT_QUEUED');

await prisma.$disconnect();
