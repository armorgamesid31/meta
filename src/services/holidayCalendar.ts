/**
 * Tatil + doğal-dil tarih çözücüsü.
 *
 * Tek dışa açık fonksiyon: `resolveDateExpression(expr, options)`.
 *   - "yarın" / "öbür gün" / "haftaya pazartesi" / "29 ekim" / "ramazan bayramı"
 *     gibi ifadeleri çözer.
 *   - Bayram aralığı için gün listesi döner; tek bir gün için tek elemanlı liste.
 *   - "bayram" muğlak ifade gelirse en yakın **dini** bayramın ilk gününe
 *     (varsa arefesinden başlayarak) yönlendirir.
 *
 * Tatil yorumu: tatil verisi `data/turkish-holidays.ts` içinde.
 * `findHolidayOnDate(yyyy_mm_dd)` ayrı export — endpoint cross-check için.
 */

import { TURKISH_HOLIDAYS, LAST_COVERED_YEAR, type HolidayEntry } from '../data/turkish-holidays.js';

// ────────────────────────────────────────────────────────────────────────────
// Yardımcılar — Europe/Istanbul'da "bugün" YYYY-MM-DD
// ────────────────────────────────────────────────────────────────────────────

const TR_TZ = 'Europe/Istanbul';

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TR_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const weekdayShortFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TR_TZ, weekday: 'short',
});

const weekdayLongTrFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TR_TZ, weekday: 'long',
});

export function todayInIstanbul(): string {
  return ymdFormatter.format(new Date()); // en-CA → YYYY-MM-DD
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  // UTC arithmetic avoids DST drift; we operate on calendar days only.
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function ymdToWeekdayKey(ymd: string): 'MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN' {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const short = weekdayShortFormatter.format(dt);
  const map: Record<string, 'MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN'> = {
    Mon: 'MON', Tue: 'TUE', Wed: 'WED', Thu: 'THU', Fri: 'FRI', Sat: 'SAT', Sun: 'SUN',
  };
  return map[short] || 'MON';
}

export function ymdToWeekdayLongTr(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return weekdayLongTrFormatter.format(dt);
}

export { ymdToWeekdayKey };

// ────────────────────────────────────────────────────────────────────────────
// Tatil lookup
// ────────────────────────────────────────────────────────────────────────────

const HOLIDAYS_BY_DATE = new Map<string, HolidayEntry>();
for (const h of TURKISH_HOLIDAYS) HOLIDAYS_BY_DATE.set(h.date, h);

export function findHolidayOnDate(ymd: string): HolidayEntry | null {
  return HOLIDAYS_BY_DATE.get(ymd) || null;
}

/**
 * Belirli grup adının (örn. "kurban bayramı") en yakın yılki TÜM günlerini döner.
 * Bayramın ortasında sorulursa o yılki tüm günler (geçenler dahil) döner; bayram
 * bittiyse bir sonraki yılın günleri döner.
 */
function nextHolidayGroupDays(groupName: string, today: string): HolidayEntry[] {
  const futureFirst = TURKISH_HOLIDAYS
    .filter(h => h.groupName === groupName && h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!futureFirst) return [];
  const year = futureFirst.date.slice(0, 4);
  return TURKISH_HOLIDAYS
    .filter(h => h.groupName === groupName && h.date.startsWith(year))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ────────────────────────────────────────────────────────────────────────────
// Doğal-dil parser
// ────────────────────────────────────────────────────────────────────────────

const TR_MONTHS: Record<string, number> = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6,
  temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
};

const TR_WEEKDAYS: Record<string, number> = {
  // Pazartesi=1 ... Pazar=7 (ISO)
  pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4,
  cuma: 5, cumartesi: 6, pazar: 7,
};

function isoWeekdayOf(ymd: string): number {
  const k = ymdToWeekdayKey(ymd);
  return ({ MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 } as const)[k];
}

function nextWeekday(today: string, targetIso: number, sameWeek = true): string {
  const cur = isoWeekdayOf(today);
  let delta = targetIso - cur;
  if (sameWeek) {
    if (delta <= 0) delta += 7;
  } else {
    // "haftaya X" → her zaman bir sonraki haftanın o günü
    delta = (7 - cur) + targetIso;
  }
  return addDaysYmd(today, delta);
}

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

export interface ResolveOptions {
  /** Bugünü dışarıdan zorla (test). Varsayılan: Istanbul'da bugün. */
  today?: string;
}

export interface ResolvedRange {
  /** Ham ifade. */
  expression: string;
  /** Sözel yorum — "yarın", "Ramazan Bayramı (2026)" vs. */
  interpretation: string;
  /** Çözülen tarihler (YYYY-MM-DD), sıralı. */
  dates: string[];
  /** Çözüm güveni. */
  ambiguous: boolean;
  /** Hiç çözülemediğinde true. */
  unresolved: boolean;
  /** Tatil tablosu kapsamı dışına taştıysa true. */
  outOfRange: boolean;
}

/**
 * Doğal-dil tarih ifadesini bir veya daha çok YYYY-MM-DD'ye çözer.
 *
 * Desteklenen formlar:
 *   - "bugün" / "yarın" / "öbür gün" / "bugünden N gün sonra"
 *   - "cumartesi" → bu haftanın cumartesi (geçtiyse gelecek hafta)
 *   - "haftaya pazartesi" → bir sonraki haftanın o günü
 *   - "29 ekim" / "29 Ekim 2027" / "29.10" / "29/10/2027"
 *   - "2026-12-31"
 *   - "bayram" → en yakın dini bayramın tüm günleri
 *   - "ramazan bayramı" / "kurban bayramı"
 *   - "yılbaşı" / "sevgililer günü" / "anneler günü" / "babalar günü"
 *   - "29 ekim cumhuriyet bayramı"
 */
export function resolveDateExpression(
  expression: string,
  options: ResolveOptions = {},
): ResolvedRange {
  const today = options.today || todayInIstanbul();
  const raw = expression || '';
  const expr = norm(raw);

  const fail: ResolvedRange = {
    expression: raw, interpretation: '', dates: [], ambiguous: false, unresolved: true, outOfRange: false,
  };

  if (!expr) return { ...fail, interpretation: '(boş ifade)' };

  // 1) ISO format direkt
  const iso = expr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return makeSingle(raw, ymd, fail);
  }

  // 2) "bugün" / "yarın" / "öbür gün"
  if (/^bugün/.test(expr)) return makeSingle(raw, today, fail, 'bugün');
  if (/^yarın/.test(expr) || /^yarin/.test(expr)) return makeSingle(raw, addDaysYmd(today, 1), fail, 'yarın');
  if (/^öbür gün/.test(expr) || /^obur gun/.test(expr)) return makeSingle(raw, addDaysYmd(today, 2), fail, 'öbür gün');

  // 3) "N gün sonra"
  const nDays = expr.match(/(\d+)\s*gün sonra/);
  if (nDays) {
    const ymd = addDaysYmd(today, Number(nDays[1]));
    return makeSingle(raw, ymd, fail, `${nDays[1]} gün sonra`);
  }

  // 4) "haftaya X" + sadece haftanın günü
  const haftaya = expr.match(/^haftaya\s+(\S+)/);
  if (haftaya && TR_WEEKDAYS[haftaya[1]]) {
    const target = TR_WEEKDAYS[haftaya[1]];
    const ymd = nextWeekday(today, target, false);
    return makeSingle(raw, ymd, fail, `haftaya ${haftaya[1]}`);
  }
  for (const [name, iso] of Object.entries(TR_WEEKDAYS)) {
    if (expr === name) {
      const ymd = nextWeekday(today, iso, true);
      return makeSingle(raw, ymd, fail, name);
    }
  }

  // 5) Tatil adı eşleşmesi — "ramazan bayramı", "kurban bayramı", spesifik isim
  const groupHit = /(ramazan bayramı|kurban bayramı|ramazan|kurban)/.exec(expr);
  if (groupHit) {
    const groupName = groupHit[1].includes('ramazan') ? 'ramazan bayramı' : 'kurban bayramı';
    const days = nextHolidayGroupDays(groupName, today);
    if (days.length) {
      return {
        expression: raw,
        interpretation: `${capitalize(groupName)} (${days[0].date.slice(0, 4)})`,
        dates: days.map(d => d.date),
        ambiguous: false,
        unresolved: false,
        outOfRange: false,
      };
    }
    return { ...fail, interpretation: capitalize(groupName), outOfRange: true, unresolved: true };
  }

  if (/\bbayram\b/.test(expr) && !/(cumhuriyet|zafer|çocuk|cocuk|atatürk|ataturk|emek|spor)/.test(expr)) {
    // Muğlak "bayram" → en yakın dini bayram
    const upcoming = TURKISH_HOLIDAYS
      .filter(h => h.type === 'religious' && h.date >= today && h.groupLabel === 'arefe')
      .sort((a, b) => a.date.localeCompare(b.date));
    const arefe = upcoming[0];
    if (arefe && arefe.groupName) {
      const days = nextHolidayGroupDays(arefe.groupName, today);
      return {
        expression: raw,
        interpretation: `${capitalize(arefe.groupName)} (${days[0]?.date.slice(0, 4) || ''}) — "bayram" en yakın dini bayrama yorumlandı`,
        dates: days.map(d => d.date),
        ambiguous: true,
        unresolved: false,
        outOfRange: false,
      };
    }
  }

  // Spesifik isimli tatiller
  const namedHolidays: { keys: RegExp; resolver: () => HolidayEntry | undefined }[] = [
    { keys: /yılbaşı|yilbasi/, resolver: () => firstUpcomingByName('Yılbaşı', today) },
    { keys: /sevgililer/, resolver: () => firstUpcomingByName('Sevgililer Günü', today) },
    { keys: /kadınlar günü|kadinlar gunu|dünya kadınlar/, resolver: () => firstUpcomingByName('Dünya Kadınlar Günü', today) },
    { keys: /anneler günü|anneler gunu/, resolver: () => firstUpcomingByName('Anneler Günü', today) },
    { keys: /babalar günü|babalar gunu/, resolver: () => firstUpcomingByName('Babalar Günü', today) },
    { keys: /öğretmenler|ogretmenler/, resolver: () => firstUpcomingByName('Öğretmenler Günü', today) },
    { keys: /cumhuriyet bayramı|cumhuriyet bayrami/, resolver: () => firstUpcomingByName('Cumhuriyet Bayramı', today) },
    { keys: /zafer bayramı|zafer bayrami/, resolver: () => firstUpcomingByName('Zafer Bayramı', today) },
    { keys: /23 nisan|çocuk bayramı|cocuk bayrami|egemenlik/, resolver: () => firstUpcomingByName('Ulusal Egemenlik ve Çocuk Bayramı', today) },
    { keys: /19 mayıs|19 mayis|gençlik ve spor|genclik ve spor/, resolver: () => firstUpcomingByName('Atatürk\'ü Anma, Gençlik ve Spor Bayramı', today) },
    { keys: /1 mayıs|1 mayis|emek/, resolver: () => firstUpcomingByName('Emek ve Dayanışma Günü', today) },
    { keys: /15 temmuz|demokrasi/, resolver: () => firstUpcomingByName('Demokrasi ve Milli Birlik Günü', today) },
  ];
  for (const np of namedHolidays) {
    if (np.keys.test(expr)) {
      const h = np.resolver();
      if (h) return makeSingle(raw, h.date, fail, h.name);
      return { ...fail, interpretation: 'bilinen tatil ama tablo dışı', outOfRange: true };
    }
  }

  // 6) "29 ekim" / "29 ekim 2027"
  const dayMonth = expr.match(/^(\d{1,2})\s+([a-zçğıöşü]+)(?:\s+(\d{4}))?$/);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthName = dayMonth[2];
    const yearOverride = dayMonth[3] ? Number(dayMonth[3]) : null;
    const month = TR_MONTHS[monthName];
    if (month && day >= 1 && day <= 31) {
      let year = yearOverride ?? Number(today.slice(0, 4));
      let ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      // Geçtiyse ve yıl override edilmediyse seneye al
      if (!yearOverride && ymd < today) {
        ymd = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      return makeSingle(raw, ymd, fail, `${day} ${capitalize(monthName)} ${ymd.slice(0, 4)}`);
    }
  }

  // 7) "29.10" / "29/10/2027"
  const numericDate = expr.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (numericDate) {
    const day = Number(numericDate[1]);
    const month = Number(numericDate[2]);
    const yearRaw = numericDate[3];
    let year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : Number(today.slice(0, 4));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!yearRaw && ymd < today) {
        ymd = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      return makeSingle(raw, ymd, fail, ymd);
    }
  }

  return { ...fail, interpretation: 'çözümlenemedi' };
}

function makeSingle(raw: string, ymd: string, fail: ResolvedRange, interp?: string): ResolvedRange {
  if (Number(ymd.slice(0, 4)) > LAST_COVERED_YEAR) {
    return { ...fail, interpretation: interp || ymd, outOfRange: true, dates: [ymd], unresolved: false };
  }
  return {
    expression: raw,
    interpretation: interp || ymd,
    dates: [ymd],
    ambiguous: false,
    unresolved: false,
    outOfRange: false,
  };
}

function firstUpcomingByName(name: string, today: string): HolidayEntry | undefined {
  return TURKISH_HOLIDAYS
    .filter(h => h.name === name && h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

export const __testing = { addDaysYmd, nextWeekday, isoWeekdayOf };
