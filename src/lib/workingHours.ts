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

// Gün kodu ↔ JS getDay (0=Pazar..6=Cumartesi). StaffWorkingHours.dayOfWeek bu
// konvansiyonu kullanır (slots-engine date.getDay() ile eşler).
export const STAFF_DAY_TO_DOW: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
export const DOW_TO_STAFF_DAY: Record<number, string> = { 0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT' };

/**
 * Personel gün-bazlı saat girdisini ({day, open, start, end}[]) StaffWorkingHours
 * createMany satırlarına çevirir. Kapalı (open:false) / geçersiz gün / geçersiz saat
 * atılır; gün başına tek satır. Sonuç boşsa [] (personel "salon saatini kullanıyor").
 * Hem self (mobile /staff-profile/working-hours) hem owner (admin /staff/:id) kullanır.
 */
export function buildStaffWorkingHourRows(
  rawDays: unknown,
  staffId: number,
): { staffId: number; dayOfWeek: number; startHour: number; endHour: number }[] {
  if (!Array.isArray(rawDays)) return [];
  const seen = new Set<number>();
  const rows: { staffId: number; dayOfWeek: number; startHour: number; endHour: number }[] = [];
  for (const d of rawDays as any[]) {
    if (!d || d.open === false) continue; // kapalı gün → satır yok
    const dow = STAFF_DAY_TO_DOW[String(d?.day ?? '').toUpperCase().trim().slice(0, 3)];
    if (dow === undefined || seen.has(dow)) continue;
    const start = Number(d.start);
    const end = Number(d.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || start > 23 || end < 1 || end > 24 || end <= start) continue;
    seen.add(dow);
    rows.push({ staffId, dayOfWeek: dow, startHour: start, endHour: end });
  }
  return rows;
}
