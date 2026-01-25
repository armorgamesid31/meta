import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../prisma';

describe('Session Routes', () => {
  let salonId: number;
  let serviceId: number;
  let staffId: number;

  beforeEach(async () => {
    // Create test data
    const salon = await prisma.salon.create({
      data: {
        name: 'Test Salon'
      }
    });
    salonId = salon.id;

    const settings = await prisma.salonSettings.create({
      data: {
        salonId,
        workStartHour: 9,
        workEndHour: 18,
        slotInterval: 30
      }
    });

    const service = await prisma.service.create({
      data: {
        salonId,
        name: 'Test Service',
        duration: 60,
        price: 100
      }
    });
    serviceId = service.id;

    const staff = await prisma.staff.create({
      data: {
        salonId,
        name: 'Test Staff'
      }
    });
    staffId = staff.id;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.appointment.deleteMany();
    await prisma.bookingSession.deleteMany();
    await prisma.service.deleteMany();
    await prisma.staff.deleteMany();
    await prisma.salonSettings.deleteMany();
    await prisma.salon.deleteMany();

    // Clean up raw SQL tables
    await prisma.$executeRaw`DELETE FROM temporary_locks`;
  });

  describe('POST /api/magic-link', () => {
    it('should create a new booking session and return booking URL', async () => {
      const response = await request(app)
        .post('/api/magic-link')
        .send({
          salonId
        });

      expect(response.status).toBe(201);
      expect(response.body.bookingUrl).toContain('/book/');
      expect(response.body.sessionToken).toBeDefined();
      expect(response.body.expiresAt).toBeDefined();

      // Verify session was created
      const session = await prisma.bookingSession.findUnique({
        where: { token: response.body.sessionToken }
      });
      expect(session).toBeTruthy();
      expect(session?.salonId).toBe(salonId);
      expect(session?.state).toBe('CREATED');
    });

    it('should return 404 for non-existent salon', async () => {
      const response = await request(app)
        .post('/api/magic-link')
        .send({
          salonId: 99999
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Salon not found.');
    });

    it('should validate salonId parameter', async () => {
      const response = await request(app)
        .post('/api/magic-link')
        .send({
          // Missing salonId
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Valid salonId is required.');
    });
  });

  describe('GET /api/sessions/:token', () => {
    it('should return session state and salon info for valid session', async () => {
      // Create a session
      const session = await prisma.bookingSession.create({
        data: {
          token: 'test-session-token',
          salonId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
        }
      });

      const response = await request(app)
        .get(`/api/sessions/${session.token}`);

      expect(response.status).toBe(200);
      expect(response.body.session.token).toBe(session.token);
      expect(response.body.session.state).toBe('CREATED');
      expect(response.body.salon.id).toBe(salonId);
      expect(response.body.salon.services).toBeDefined();
      expect(response.body.salon.staff).toBeDefined();
    });

    it('should return 404 for non-existent session', async () => {
      const response = await request(app)
        .get('/api/sessions/non-existent-token');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Session not found.');
    });

    it('should return 410 for expired session', async () => {
      // Create an expired session
      const session = await prisma.bookingSession.create({
        data: {
          token: 'expired-session-token',
          salonId,
          expiresAt: new Date(Date.now() - 60 * 1000) // 1 minute ago
        }
      });

      const response = await request(app)
        .get(`/api/sessions/${session.token}`);

      expect(response.status).toBe(410);
      expect(response.body.message).toBe('Session has expired.');
    });
  });

  describe('GET /api/sessions/:token/availability', () => {
    it('should return availability slots for valid session', async () => {
      // Create a session
      const session = await prisma.bookingSession.create({
        data: {
          token: 'availability-session-token',
          salonId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .get(`/api/sessions/${session.token}/availability?date=2024-01-25`);

      expect(response.status).toBe(200);
      expect(response.body.slots).toBeDefined();
      expect(Array.isArray(response.body.slots)).toBe(true);
      expect(response.body.lockToken).toBeDefined();
    });

    it('should return 404 for non-existent session', async () => {
      const response = await request(app)
        .get('/api/sessions/non-existent-token/availability?date=2024-01-25');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Session not found.');
    });

    it('should return 410 for expired session', async () => {
      // Create an expired session
      const session = await prisma.bookingSession.create({
        data: {
          token: 'expired-availability-token',
          salonId,
          expiresAt: new Date(Date.now() - 60 * 1000)
        }
      });

      const response = await request(app)
        .get(`/api/sessions/${session.token}/availability?date=2024-01-25`);

      expect(response.status).toBe(410);
      expect(response.body.message).toBe('Session has expired.');
    });

    it('should validate date parameter', async () => {
      const session = await prisma.bookingSession.create({
        data: {
          token: 'date-validation-token',
          salonId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .get(`/api/sessions/${session.token}/availability`);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Date parameter is required.');
    });
  });

  describe('POST /api/sessions/:token/lock', () => {
    it('should lock a slot and update session state', async () => {
      // Create a session
      const session = await prisma.bookingSession.create({
        data: {
          token: 'lock-session-token',
          salonId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const slotData = {
        date: '2024-01-25',
        startTime: '10:00',
        serviceId,
        staffIds: [staffId],
        peopleCount: 1
      };

      const response = await request(app)
        .post(`/api/sessions/${session.token}/lock`)
        .send({ slot: slotData });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Slot locked successfully.');
      expect(response.body.session.state).toBe('SLOT_SELECTED');
      expect(response.body.session.selectedSlot).toEqual(slotData);

      // Verify session was updated
      const updatedSession = await prisma.bookingSession.findUnique({
        where: { token: session.token }
      });
      expect(updatedSession?.state).toBe('SLOT_SELECTED');
      expect(updatedSession?.selectedSlot).toEqual(slotData);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await request(app)
        .post('/api/sessions/non-existent-token/lock')
        .send({
          slot: {
            date: '2024-01-25',
            startTime: '10:00',
            serviceId,
            staffIds: [staffId],
            peopleCount: 1
          }
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Session not found.');
    });

    it('should return 410 for expired session', async () => {
      // Create an expired session
      const session = await prisma.bookingSession.create({
        data: {
          token: 'expired-lock-token',
          salonId,
          expiresAt: new Date(Date.now() - 60 * 1000)
        }
      });

      const response = await request(app)
        .post(`/api/sessions/${session.token}/lock`)
        .send({
          slot: {
            date: '2024-01-25',
            startTime: '10:00',
            serviceId,
            staffIds: [staffId],
            peopleCount: 1
          }
        });

      expect(response.status).toBe(410);
      expect(response.body.message).toBe('Session has expired.');
    });

    it('should validate slot data', async () => {
      const session = await prisma.bookingSession.create({
        data: {
          token: 'validation-lock-token',
          salonId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .post(`/api/sessions/${session.token}/lock`)
        .send({
          // Missing slot data
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Valid slot data is required.');
    });
  });

  describe('POST /api/sessions/:token/confirm', () => {
    it('should confirm booking with valid session and lock', async () => {
      // Create a session with selected slot
      const lockToken = 'test-lock-for-confirm';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockToken}, ${salonId}, '2024-01-25', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      const session = await prisma.bookingSession.create({
        data: {
          token: 'confirm-session-token',
          salonId,
          state: 'SLOT_SELECTED',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          selectedSlot: {
            date: '2024-01-25',
            startTime: '10:00',
            serviceId,
            staffIds: [staffId],
            peopleCount: 1,
            lockToken
          }
        }
      });

      const customerInfo = {
        name: 'John Doe',
        phone: '555-0123',
        email: 'john@example.com'
      };

      const response = await request(app)
        .post(`/api/sessions/${session.token}/confirm`)
        .send({ customerInfo });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Booking confirmed successfully.');
      expect(response.body.appointments).toHaveLength(1);

      // Verify appointment was created
      const appointment = await prisma.appointment.findFirst({
        where: { salonId }
      });
      expect(appointment).toBeTruthy();
      expect(appointment?.customerName).toBe('John Doe');
      expect(appointment?.source).toBe('CUSTOMER');

      // Verify session was updated
      const updatedSession = await prisma.bookingSession.findUnique({
        where: { token: session.token }
      });
      expect(updatedSession?.state).toBe('CONFIRMED');
      expect(updatedSession?.customerInfo).toEqual(customerInfo);

      // Verify lock was deleted
      const lockExists = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM temporary_locks WHERE id = ${lockToken}
      ` as any[];
      expect(lockExists[0].count).toBe(0);
    });

    it('should return 400 when no slot is selected', async () => {
      // Create a session without selected slot
      const session = await prisma.bookingSession.create({
        data: {
          token: 'no-slot-session-token',
          salonId,
          state: 'CREATED',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .post(`/api/sessions/${session.token}/confirm`)
        .send({
          customerInfo: {
            name: 'John Doe',
            phone: '555-0123'
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('No slot selected for this session.');
    });

    it('should return 409 when lock token is expired', async () => {
      // Create a session with expired lock
      const expiredLockToken = 'expired-lock-for-confirm';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${expiredLockToken}, ${salonId}, '2024-01-25', '10:00', '60', ${new Date(Date.now() - 10 * 60 * 1000)}, NOW())
      `;

      const session = await prisma.bookingSession.create({
        data: {
          token: 'expired-lock-session-token',
          salonId,
          state: 'SLOT_SELECTED',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          selectedSlot: {
            date: '2024-01-25',
            startTime: '10:00',
            serviceId,
            staffIds: [staffId],
            peopleCount: 1,
            lockToken: expiredLockToken
          }
        }
      });

      const response = await request(app)
        .post(`/api/sessions/${session.token}/confirm`)
        .send({
          customerInfo: {
            name: 'John Doe',
            phone: '555-0123'
          }
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('Lock token has expired or is invalid.');
    });

    it('should validate customer information', async () => {
      const session = await prisma.bookingSession.create({
        data: {
          token: 'validation-confirm-token',
          salonId,
          state: 'SLOT_SELECTED',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          selectedSlot: {
            date: '2024-01-25',
            startTime: '10:00',
            serviceId,
            staffIds: [staffId],
            peopleCount: 1
          }
        }
      });

      const response = await request(app)
        .post(`/api/sessions/${session.token}/confirm`)
        .send({
          // Missing customerInfo
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Customer information is required.');
    });
  });
});