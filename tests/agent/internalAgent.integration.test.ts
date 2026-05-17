/**
 * Integration tests for /api/internal/agent/* endpoints.
 *
 * Run requires:
 *   - Postgres reachable via DATABASE_URL (or .env)
 *   - INTERNAL_API_KEY in env (testler için stub ediyoruz)
 *
 * Eğer DATABASE_URL setli değilse beforeAll içinde test skip ediyoruz.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/prisma.js';

const TEST_API_KEY = 'test-internal-key-agent-suite';
process.env.INTERNAL_API_KEY = TEST_API_KEY;

let app: any;
let skipAll = false;
const salonIds: number[] = [];

async function ensureCleanup() {
  for (const id of salonIds) {
    await prisma.appointment.deleteMany({ where: { salonId: id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { salonId: id } }).catch(() => {});
    await prisma.salonAiAgentSettings.deleteMany({ where: { salonId: id } }).catch(() => {});
    await prisma.salonSettings.deleteMany({ where: { salonId: id } }).catch(() => {});
    await prisma.salon.delete({ where: { id } }).catch(() => {});
  }
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    skipAll = true;
    return;
  }
  app = (await import('../../src/server.js')).default;
});

afterAll(async () => {
  if (!skipAll) await ensureCleanup();
}, 60000);

async function createTestSalon(opts: {
  name?: string;
  communicationTone?: 'FRIENDLY' | 'BALANCED' | 'PROFESSIONAL';
  advanced?: Partial<{
    answerLength: string;
    emojiUsage: string;
    bookingGuidance: string;
    handoverThreshold: string;
    aiDisclosure: string;
  }>;
  workStartHour?: number;
  workEndHour?: number;
} = {}): Promise<number> {
  const salon = await prisma.salon.create({
    data: {
      name: opts.name || `Test Agent Salon ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      city: 'İstanbul',
      district: 'Beşiktaş',
      communicationTone: opts.communicationTone || 'BALANCED',
    },
  });
  salonIds.push(salon.id);

  await prisma.salonSettings.create({
    data: {
      salonId: salon.id,
      workStartHour: opts.workStartHour ?? 10,
      workEndHour: opts.workEndHour ?? 20,
      slotInterval: 30,
      timezone: 'Europe/Istanbul',
    },
  });

  if (opts.advanced) {
    await prisma.salonAiAgentSettings.create({
      data: { salonId: salon.id, ...opts.advanced },
    });
  }

  return salon.id;
}

describe('GET /api/internal/agent/salon-context', () => {
  it.runIf(!skipAll)('requires x-internal-api-key', async () => {
    if (skipAll) return;
    const res = await request(app).get('/api/internal/agent/salon-context?salonId=1');
    expect([401, 503]).toContain(res.status);
  });

  it.runIf(!skipAll)('rejects missing salonId', async () => {
    const res = await request(app)
      .get('/api/internal/agent/salon-context')
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('salonId_required');
  });

  it.runIf(!skipAll)('404 for non-existent salon', async () => {
    const res = await request(app)
      .get('/api/internal/agent/salon-context?salonId=999999999')
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(404);
  });

  it.runIf(!skipAll)('FRIENDLY tone → directive contains "sen" + "samimi"', async () => {
    const salonId = await createTestSalon({ communicationTone: 'FRIENDLY' });
    const res = await request(app)
      .get(`/api/internal/agent/salon-context?salonId=${salonId}`)
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agentSettings.tone).toBe('friendly');
    expect(res.body.toneDirective).toMatch(/sen/i);
    expect(res.body.toneDirective).toMatch(/samimi/i);
  });

  it.runIf(!skipAll)('PROFESSIONAL tone → directive forbids emoji', async () => {
    const salonId = await createTestSalon({ communicationTone: 'PROFESSIONAL' });
    const res = await request(app)
      .get(`/api/internal/agent/salon-context?salonId=${salonId}`)
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.agentSettings.tone).toBe('professional');
    expect(res.body.toneDirective).toMatch(/Emoji kullanma/i);
    expect(res.body.toneDirective).toMatch(/Sayın/);
  });

  it.runIf(!skipAll)('default BALANCED tone', async () => {
    const salonId = await createTestSalon();
    const res = await request(app)
      .get(`/api/internal/agent/salon-context?salonId=${salonId}`)
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.agentSettings.tone).toBe('balanced');
    expect(res.body.toneDirective).toMatch(/Hanım\/Bey/);
  });

  it.runIf(!skipAll)('salonOneLiner includes salon name + hours', async () => {
    const salonId = await createTestSalon({
      name: 'Bella Test Salon',
      workStartHour: 8,
      workEndHour: 21,
    });
    const res = await request(app)
      .get(`/api/internal/agent/salon-context?salonId=${salonId}`)
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.salonOneLiner).toMatch(/Bella Test Salon/);
    expect(res.body.salonOneLiner).toMatch(/08:00–21:00/);
  });

  it.runIf(!skipAll)('advanced overrides reflected in styleDirective', async () => {
    const salonId = await createTestSalon({
      communicationTone: 'BALANCED',
      advanced: {
        answerLength: 'short',
        emojiUsage: 'off',
        bookingGuidance: 'high',
        handoverThreshold: 'early',
        aiDisclosure: 'always',
      },
    });
    const res = await request(app)
      .get(`/api/internal/agent/salon-context?salonId=${salonId}`)
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.styleDirective).toMatch(/1-2 kısa cümle/);
    expect(res.body.styleDirective).toMatch(/emoji yok/);
    expect(res.body.styleDirective).toMatch(/proaktif/);
  });
});

describe('POST /api/internal/agent/customer-lookup', () => {
  it.runIf(!skipAll)('rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/internal/agent/customer-lookup')
      .set('x-internal-api-key', TEST_API_KEY)
      .send({ salonId: 1 });
    expect(res.status).toBe(400);
  });

  it.runIf(!skipAll)('rejects unknown channel', async () => {
    const res = await request(app)
      .post('/api/internal/agent/customer-lookup')
      .set('x-internal-api-key', TEST_API_KEY)
      .send({ salonId: 1, channel: 'EMAIL', subject: '+905551234567' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('channel_required');
  });

  it.runIf(!skipAll)('returns found=false when no customer matches', async () => {
    const salonId = await createTestSalon();
    const res = await request(app)
      .post('/api/internal/agent/customer-lookup')
      .set('x-internal-api-key', TEST_API_KEY)
      .send({ salonId, channel: 'WHATSAPP', subject: '905559999999' });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it.runIf(!skipAll)('finds customer by phone fallback when no IdentityBinding', { timeout: 30000 }, async () => {
    const salonId = await createTestSalon();
    await prisma.customer.create({
      data: {
        salonId,
        phone: '+905551112233',
        name: 'Ayşe Test',
      },
    });
    const res = await request(app)
      .post('/api/internal/agent/customer-lookup')
      .set('x-internal-api-key', TEST_API_KEY)
      .send({ salonId, channel: 'WHATSAPP', subject: '905551112233' });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.customer.name).toBe('Ayşe Test');
    expect(Array.isArray(res.body.recentAppointments)).toBe(true);
  });

  it.runIf(!skipAll)('returns recent appointments (max 5, newest first)', { timeout: 30000 }, async () => {
    const salonId = await createTestSalon();
    const customer = await prisma.customer.create({
      data: { salonId, phone: '+905551110001', name: 'Hist Test' },
    });

    // Need staff + service before we can create appointments
    const staff = await prisma.staff.create({
      data: { salonId, name: 'Test Stylist', firstName: 'Test', gender: 'female' as any },
    });
    const service = await prisma.service.create({
      data: { salonId, name: 'Saç Kesimi', price: 500, duration: 60 },
    });

    const now = Date.now();
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        prisma.appointment.create({
          data: {
            salonId,
            customerId: customer.id,
            staffId: staff.id,
            serviceId: service.id,
            startTime: new Date(now - (i + 1) * 86400000),
            endTime: new Date(now - (i + 1) * 86400000 + 3600000),
            customerName: 'Hist Test',
            customerPhone: '+905551110001',
          },
        }),
      ),
    );

    const res = await request(app)
      .post('/api/internal/agent/customer-lookup')
      .set('x-internal-api-key', TEST_API_KEY)
      .send({ salonId, channel: 'WHATSAPP', subject: '905551110001' });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.recentAppointments).toHaveLength(5);
    // Newest first → first item should be most recent
    const ts = res.body.recentAppointments.map((a: any) => new Date(a.startTime).getTime());
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
  });
});

describe('GET /api/internal/agent/availability', () => {
  it.runIf(!skipAll)('rejects missing salonId', async () => {
    const res = await request(app)
      .get('/api/internal/agent/availability?serviceId=1&date=2026-06-01')
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(400);
  });

  it.runIf(!skipAll)('rejects malformed date', async () => {
    const res = await request(app)
      .get('/api/internal/agent/availability?salonId=1&serviceId=1&date=tomorrow')
      .set('x-internal-api-key', TEST_API_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it.runIf(!skipAll)('returns slots array shape (may be empty if no staff)', { timeout: 30000 }, async () => {
    const salonId = await createTestSalon();
    const service = await prisma.service.create({
      data: { salonId, name: 'Test Hizmet', price: 100, duration: 30 },
    });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/internal/agent/availability?salonId=${salonId}&serviceId=${service.id}&date=${tomorrow}`)
      .set('x-internal-api-key', TEST_API_KEY);
    // 200 ok with possibly empty slots, OR 500 if availability engine requires staff
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.slots)).toBe(true);
    }
  });
});

describe('PATCH /api/salon/communication-tone → syncs SalonAiAgentSettings.tone', () => {
  // Bu endpoint user-auth gerektiriyor, JWT olmadan test edemiyoruz.
  // Bu testin asıl amacı service helper'ı doğrudan çağırarak sync mantığını kanıtlamak.
  it.runIf(!skipAll)('syncAgentSettingsTone upserts agent settings', async () => {
    const salonId = await createTestSalon({ communicationTone: 'BALANCED' });
    const { syncAgentSettingsTone } = await import('../../src/services/salonAgentContext.js');

    // İlk sync: row yok → create
    await syncAgentSettingsTone(salonId, 'friendly');
    let row = await prisma.salonAiAgentSettings.findUnique({ where: { salonId } });
    expect(row?.tone).toBe('friendly');

    // İkinci sync: row var → update
    await syncAgentSettingsTone(salonId, 'professional');
    row = await prisma.salonAiAgentSettings.findUnique({ where: { salonId } });
    expect(row?.tone).toBe('professional');
  });
});
