// Gün-bazlı çalışma saati (SalonSettings.workingHoursByDay) ortak yardımcıları.
// Şekil: { "MON": { start: 9, end: 18 }, "SAT": { start: 9, end: 13 }, ... }
// Bir gün için kayıt yoksa düz workStartHour/workEndHour geçerlidir.
// Bu şekli booking motoru (slots-engine), AI (salonAgentContext + check_day_open)
// ve ayar endpoint'leri (admin/setup, salon/settings) OKUR/YAZAR — tek kaynak.

export const WORKING_DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WorkingDayCode = (typeof WORKING_DAY_CODES)[number];
export type WorkingHoursByDay = Partial<Record<WorkingDayCode, { start: number; end: number }>>;

/**
 * App/istemciden gelen ham workingHoursByDay'i WRITE öncesi doğrular ve temizler.
 * Geçersiz gün kodu / saat atılır. Sonuç boşsa null döner (→ düz saate düş).
 */
export function normalizeWorkingHoursByDay(input: unknown): WorkingHoursByDay | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: WorkingHoursByDay = {};
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey).toUpperCase().trim().slice(0, 3) as WorkingDayCode;
    if (!WORKING_DAY_CODES.includes(key)) continue;
    if (!rawVal || typeof rawVal !== 'object') continue;
    const v = rawVal as Record<string, unknown>;
    const start = Number(v.start);
    const end = Number(v.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    // start 0-23, end 1-24, end > start (geçerli aralık).
    if (start < 0 || start > 23 || end < 1 || end > 24 || end <= start) continue;
    out[key] = { start, end };
  }
  return Object.keys(out).length ? out : null;
}
