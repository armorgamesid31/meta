/**
 * Regression guard for DEFAULT_RECIPIENTS in services/notifications.ts.
 *
 * Salon 8 case study: HANDOVER bildirimi sadece OWNER/MANAGER/RECEPTION'a
 * gidiyordu; owner mobil app'a giriş yapmadıysa veya push tokenı yoksa,
 * salon hiçbir uyarı almıyordu. STAFF'ı HANDOVER recipient'ına ekleyerek
 * salondaki herkesin telefonu çalsın istedik.
 *
 * Bu test:
 *   - HANDOVER_REQUIRED / HANDOVER_REMINDER → 4 rol (STAFF dahil) doğrular
 *   - Diğer eventlere yanlışlıkla STAFF eklenmediğini doğrular
 *     (örn. DAILY_MANAGER_REPORT staff'a gitmemeli)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// notifications.ts module-level olarak DEFAULT_RECIPIENTS'ı export ETMİYOR;
// dosya source'unu okuyup hash-equality kontrolü yapıyoruz. Bu, çalışan kodla
// senkron olmayan testlerden korur (import-and-evaluate hızlı ama side-effect riski).
const NOTIF_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../src/services/notifications.ts'),
  'utf8',
);

function rolesFor(event: string): string[] {
  const re = new RegExp(`${event}\\s*:\\s*\\[([^\\]]+)\\]`);
  const m = NOTIF_SRC.match(re);
  if (!m) throw new Error(`${event} not found in DEFAULT_RECIPIENTS`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

describe('DEFAULT_RECIPIENTS — HANDOVER reaches STAFF too', () => {
  it('HANDOVER_REQUIRED includes OWNER, MANAGER, RECEPTION, STAFF', () => {
    const roles = rolesFor('HANDOVER_REQUIRED');
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'MANAGER', 'RECEPTION', 'STAFF']));
  });

  it('HANDOVER_REMINDER also includes STAFF', () => {
    const roles = rolesFor('HANDOVER_REMINDER');
    expect(roles).toContain('STAFF');
  });

  it('DAILY_MANAGER_REPORT does NOT include STAFF (manager-only intel)', () => {
    const roles = rolesFor('DAILY_MANAGER_REPORT');
    expect(roles).not.toContain('STAFF');
  });

  it('END_OF_DAY_MISSING_DATA does NOT include STAFF', () => {
    const roles = rolesFor('END_OF_DAY_MISSING_DATA');
    expect(roles).not.toContain('STAFF');
  });

  it('CAMPAIGN_AUTO_TRIGGER does NOT include STAFF', () => {
    const roles = rolesFor('CAMPAIGN_AUTO_TRIGGER');
    expect(roles).not.toContain('STAFF');
  });
});
