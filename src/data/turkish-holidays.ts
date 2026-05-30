/**
 * Türkiye tatil sözlüğü — 2026-2028.
 *
 * Üç kategori:
 *   - national  : Resmi tatil (1 Ocak, 23 Nisan, 1 Mayıs, 19 Mayıs, 15 Temmuz,
 *                 30 Ağustos, 29 Ekim ve arefeler).
 *   - religious : Dini bayram (Ramazan + Kurban, arefe dahil).
 *                 "bayram" muğlak ifade gelirse default bu kategori sayılır.
 *   - semi_official : Yarı-resmi (Sevgililer, Anneler, Babalar, Kadınlar,
 *                 Öğretmenler, Yılbaşı arefesi). Salon kapalı sayılmaz —
 *                 sadece bilgi amaçlı.
 *
 * `closesByDefault`:
 *   true  → Türkiye'de işyerlerinin çoğu kapalı; salon SalonClosure kaydı
 *           olmasa bile agent'ın "muhtemelen kapalıyız" yönünde davranması
 *           için flag. Final cevap yine de SalonClosure + workingDays'ten
 *           üretilir; bu sadece bir hint.
 *   false → Çalışılan gün. Yarı-resmi günler bu kategoride.
 *   'half'→ Yarım gün (öğleden sonra).
 *
 * NOT — DİNİ BAYRAM TARİHLERİ TAHMİNDİR.
 * Hicri takvim ~11 gün/yıl kayar. Aşağıdaki tarihler Diyanet'in tipik
 * takvimine göre yazılmıştır ancak ay gözlemine bağlı olarak ±1 gün
 * değişebilir. Production'a almadan Diyanet'in resmi takvimi ile
 * doğrulanmalı.
 */

export type HolidayType = 'national' | 'religious' | 'semi_official';
export type HolidayClose = true | false | 'half';

export interface HolidayEntry {
  date: string;             // YYYY-MM-DD
  name: string;             // Tam isim (örn. "Ramazan Bayramı 1. Gün")
  type: HolidayType;
  closesByDefault: HolidayClose;
  /** Bayram grubu adı — "ramazan bayramı" / "kurban bayramı" araması için. */
  groupName?: string;
  /** Grup içi sıra (1, 2, 3) ya da "arefe". */
  groupLabel?: string;
}

export const TURKISH_HOLIDAYS: HolidayEntry[] = [
  // ============================== 2026 ==============================
  // Resmi
  { date: '2026-01-01', name: 'Yılbaşı', type: 'national', closesByDefault: true },
  { date: '2026-04-23', name: 'Ulusal Egemenlik ve Çocuk Bayramı', type: 'national', closesByDefault: true },
  { date: '2026-05-01', name: 'Emek ve Dayanışma Günü', type: 'national', closesByDefault: true },
  { date: '2026-05-19', name: 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı', type: 'national', closesByDefault: true },
  { date: '2026-07-15', name: 'Demokrasi ve Milli Birlik Günü', type: 'national', closesByDefault: true },
  { date: '2026-08-30', name: 'Zafer Bayramı', type: 'national', closesByDefault: true },
  { date: '2026-10-28', name: 'Cumhuriyet Bayramı Arefesi', type: 'national', closesByDefault: 'half' },
  { date: '2026-10-29', name: 'Cumhuriyet Bayramı', type: 'national', closesByDefault: true },

  // Dini — Ramazan Bayramı 2026 (Mart 20-22, arefe 19)
  { date: '2026-03-19', name: 'Ramazan Bayramı Arefesi', type: 'religious', closesByDefault: 'half', groupName: 'ramazan bayramı', groupLabel: 'arefe' },
  { date: '2026-03-20', name: 'Ramazan Bayramı 1. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '1' },
  { date: '2026-03-21', name: 'Ramazan Bayramı 2. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '2' },
  { date: '2026-03-22', name: 'Ramazan Bayramı 3. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '3' },

  // Dini — Kurban Bayramı 2026 (Mayıs 27-30, arefe 26)
  { date: '2026-05-26', name: 'Kurban Bayramı Arefesi', type: 'religious', closesByDefault: 'half', groupName: 'kurban bayramı', groupLabel: 'arefe' },
  { date: '2026-05-27', name: 'Kurban Bayramı 1. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '1' },
  { date: '2026-05-28', name: 'Kurban Bayramı 2. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '2' },
  { date: '2026-05-29', name: 'Kurban Bayramı 3. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '3' },
  { date: '2026-05-30', name: 'Kurban Bayramı 4. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '4' },

  // Yarı-resmi
  { date: '2026-02-14', name: 'Sevgililer Günü', type: 'semi_official', closesByDefault: false },
  { date: '2026-03-08', name: 'Dünya Kadınlar Günü', type: 'semi_official', closesByDefault: false },
  { date: '2026-05-10', name: 'Anneler Günü', type: 'semi_official', closesByDefault: false },
  { date: '2026-06-21', name: 'Babalar Günü', type: 'semi_official', closesByDefault: false },
  { date: '2026-11-24', name: 'Öğretmenler Günü', type: 'semi_official', closesByDefault: false },
  { date: '2026-12-31', name: 'Yılbaşı Arefesi', type: 'semi_official', closesByDefault: false },

  // ============================== 2027 ==============================
  { date: '2027-01-01', name: 'Yılbaşı', type: 'national', closesByDefault: true },
  { date: '2027-04-23', name: 'Ulusal Egemenlik ve Çocuk Bayramı', type: 'national', closesByDefault: true },
  { date: '2027-05-01', name: 'Emek ve Dayanışma Günü', type: 'national', closesByDefault: true },
  { date: '2027-05-19', name: 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı', type: 'national', closesByDefault: true },
  { date: '2027-07-15', name: 'Demokrasi ve Milli Birlik Günü', type: 'national', closesByDefault: true },
  { date: '2027-08-30', name: 'Zafer Bayramı', type: 'national', closesByDefault: true },
  { date: '2027-10-28', name: 'Cumhuriyet Bayramı Arefesi', type: 'national', closesByDefault: 'half' },
  { date: '2027-10-29', name: 'Cumhuriyet Bayramı', type: 'national', closesByDefault: true },

  // Dini — Ramazan Bayramı 2027 (Mart 9-11, arefe 8)
  { date: '2027-03-08', name: 'Ramazan Bayramı Arefesi', type: 'religious', closesByDefault: 'half', groupName: 'ramazan bayramı', groupLabel: 'arefe' },
  { date: '2027-03-09', name: 'Ramazan Bayramı 1. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '1' },
  { date: '2027-03-10', name: 'Ramazan Bayramı 2. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '2' },
  { date: '2027-03-11', name: 'Ramazan Bayramı 3. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '3' },

  // Dini — Kurban Bayramı 2027 (Mayıs 17-20, arefe 16)
  { date: '2027-05-16', name: 'Kurban Bayramı Arefesi', type: 'religious', closesByDefault: 'half', groupName: 'kurban bayramı', groupLabel: 'arefe' },
  { date: '2027-05-17', name: 'Kurban Bayramı 1. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '1' },
  { date: '2027-05-18', name: 'Kurban Bayramı 2. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '2' },
  { date: '2027-05-19', name: 'Kurban Bayramı 3. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '3' },
  { date: '2027-05-20', name: 'Kurban Bayramı 4. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '4' },

  // Yarı-resmi
  { date: '2027-02-14', name: 'Sevgililer Günü', type: 'semi_official', closesByDefault: false },
  { date: '2027-03-08', name: 'Dünya Kadınlar Günü', type: 'semi_official', closesByDefault: false },
  { date: '2027-05-09', name: 'Anneler Günü', type: 'semi_official', closesByDefault: false },
  { date: '2027-06-20', name: 'Babalar Günü', type: 'semi_official', closesByDefault: false },
  { date: '2027-11-24', name: 'Öğretmenler Günü', type: 'semi_official', closesByDefault: false },
  { date: '2027-12-31', name: 'Yılbaşı Arefesi', type: 'semi_official', closesByDefault: false },

  // ============================== 2028 ==============================
  { date: '2028-01-01', name: 'Yılbaşı', type: 'national', closesByDefault: true },
  { date: '2028-04-23', name: 'Ulusal Egemenlik ve Çocuk Bayramı', type: 'national', closesByDefault: true },
  { date: '2028-05-01', name: 'Emek ve Dayanışma Günü', type: 'national', closesByDefault: true },
  { date: '2028-05-19', name: 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı', type: 'national', closesByDefault: true },
  { date: '2028-07-15', name: 'Demokrasi ve Milli Birlik Günü', type: 'national', closesByDefault: true },
  { date: '2028-08-30', name: 'Zafer Bayramı', type: 'national', closesByDefault: true },
  { date: '2028-10-28', name: 'Cumhuriyet Bayramı Arefesi', type: 'national', closesByDefault: 'half' },
  { date: '2028-10-29', name: 'Cumhuriyet Bayramı', type: 'national', closesByDefault: true },

  // Dini — Ramazan Bayramı 2028 (Şubat 26-28, arefe 25)
  { date: '2028-02-25', name: 'Ramazan Bayramı Arefesi', type: 'religious', closesByDefault: 'half', groupName: 'ramazan bayramı', groupLabel: 'arefe' },
  { date: '2028-02-26', name: 'Ramazan Bayramı 1. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '1' },
  { date: '2028-02-27', name: 'Ramazan Bayramı 2. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '2' },
  { date: '2028-02-28', name: 'Ramazan Bayramı 3. Gün', type: 'religious', closesByDefault: true, groupName: 'ramazan bayramı', groupLabel: '3' },

  // Dini — Kurban Bayramı 2028 (Mayıs 5-8, arefe 4)
  { date: '2028-05-04', name: 'Kurban Bayramı Arefesi', type: 'religious', closesByDefault: 'half', groupName: 'kurban bayramı', groupLabel: 'arefe' },
  { date: '2028-05-05', name: 'Kurban Bayramı 1. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '1' },
  { date: '2028-05-06', name: 'Kurban Bayramı 2. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '2' },
  { date: '2028-05-07', name: 'Kurban Bayramı 3. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '3' },
  { date: '2028-05-08', name: 'Kurban Bayramı 4. Gün', type: 'religious', closesByDefault: true, groupName: 'kurban bayramı', groupLabel: '4' },

  // Yarı-resmi
  { date: '2028-02-14', name: 'Sevgililer Günü', type: 'semi_official', closesByDefault: false },
  { date: '2028-03-08', name: 'Dünya Kadınlar Günü', type: 'semi_official', closesByDefault: false },
  { date: '2028-05-14', name: 'Anneler Günü', type: 'semi_official', closesByDefault: false },
  { date: '2028-06-18', name: 'Babalar Günü', type: 'semi_official', closesByDefault: false },
  { date: '2028-11-24', name: 'Öğretmenler Günü', type: 'semi_official', closesByDefault: false },
  { date: '2028-12-31', name: 'Yılbaşı Arefesi', type: 'semi_official', closesByDefault: false },
];

/** Tabloda kapsanmayan en geç yıl. Bunun ötesinde sorgu gelirse "table_outdated" işareti döner. */
export const LAST_COVERED_YEAR = 2028;
