import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../server';
import { prisma } from '../prisma';

describe('Booking Routes', () => {
  let authToken: string;
  let salonId: number;
  let userId: number;
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

    const user = await prisma.salonUser.create({
      data: {
        email: 'test@example.com',
        passwordHash: 'hashedpassword',
        role: 'OWNER',
        salonId
      }
    });
    userId = user.id;

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

    // Generate auth token (simplified for testing)
    authToken = 'test-token';
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.appointment.deleteMany();
    await prisma.service.deleteMany();
    await prisma.staff.deleteMany();
    await prisma.salonSettings.deleteMany();
    await prisma.salonUser.deleteMany();
    await prisma.salon.deleteMany();

    // Clean up raw SQL tables
    await prisma.$executeRaw`DELETE FROM temporary_locks`;
  });

  describe('POST /api/bookings/confirm', () => {
    it('should confirm booking with valid lock token', async () => {
      // Create a valid lock token
      const lockId = 'test-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [staffId]
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Booking confirmed successfully.');
      expect(response.body.appointments).toHaveLength(1);

      // Verify appointment was created
      const appointment = await prisma.appointment.findFirst({
        where: { salonId }
      });
      expect(appointment).toBeTruthy();
      expect(appointment?.customerName).toBe('John Doe');

      // Verify lock was deleted
      const lockExists = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM temporary_locks WHERE id = ${lockId}
      ` as any[];
      expect(lockExists[0].count).toBe(0);
    });

    it('should return 404 for non-existent lock token', async () => {
      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: 'non-existent-lock',
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [staffId]
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Lock token not found.');
    });

    it('should return 410 for expired lock token', async () => {
      // Create an expired lock token
      const lockId = 'expired-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() - 10 * 60 * 1000)}, NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [staffId]
        });

      expect(response.status).toBe(410);
      expect(response.body.message).toBe('Lock token has expired.');
    });

    it('should return 409 when slot is no longer available', async () => {
      // Create a valid lock token
      const lockId = 'conflict-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      // Create a conflicting appointment
      await prisma.appointment.create({
        data: {
          salonId,
          staffId,
          serviceId,
          customerName: 'Existing Customer',
          customerPhone: '555-0000',
          startTime: new Date('2024-01-20T10:00:00'),
          endTime: new Date('2024-01-20T11:00:00'),
          status: 'BOOKED'
        }
      });

      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [staffId]
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('Slot is no longer available.');
    });

    it('should support multi-person bookings', async () => {
      // Create additional staff
      const staff2 = await prisma.staff.create({
        data: {
          salonId,
          name: 'Test Staff 2'
        }
      });

      // Create a valid lock token for 2-person booking
      const lockId = 'multi-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [staffId, staff2.id]
        });

      expect(response.status).toBe(201);
      expect(response.body.appointments).toHaveLength(2);

      // Verify both appointments were created
      const appointments = await prisma.appointment.findMany({
        where: { salonId }
      });
      expect(appointments).toHaveLength(2);
    });

    it('should ensure idempotency - lock can only be used once', async () => {
      // Create a valid lock token
      const lockId = 'idempotent-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      // First booking attempt
      const response1 = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [staffId]
        });

      expect(response1.status).toBe(201);

      // Second booking attempt with same lock
      const response2 = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'Jane Smith',
          customerPhone: '555-0456',
          serviceId,
          staffIds: [staffId]
        });

      expect(response2.status).toBe(404);
      expect(response2.body.message).toBe('Lock token not found.');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          // Missing required fields
          customerName: 'John Doe'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Missing required fields.');
    });

    it('should validate service exists', async () => {
      const lockId = 'service-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId: 999, // Non-existent service
          staffIds: [staffId]
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Service not found.');
    });

    it('should validate staff belong to salon', async () => {
      const lockId = 'staff-lock-123';
      await prisma.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, '2024-01-20', '10:00', '60', ${new Date(Date.now() + 20 * 60 * 1000)}, NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lockToken: lockId,
          customerName: 'John Doe',
          customerPhone: '555-0123',
          serviceId,
          staffIds: [999] // Non-existent staff
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid staff selection.');
    });
  });

  describe('POST /api/bookings/cancel', () => {
    it('should cancel a future booking successfully', async () => {
      // Create a future booking in the legacy randevular table
      const bookingId = 12345;
      await prisma.$executeRaw`
        INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
        VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-25', '14:00', '60', 'aktif', 'John Doe', '555-0123', NOW(), NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          bookingId
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Booking cancelled successfully.');
      expect(response.body.bookingId).toBe(bookingId);

      // Verify booking was marked as cancelled in legacy table
      const cancelledBooking = await prisma.$queryRaw`
        SELECT * FROM randevular WHERE id = ${bookingId}
      ` as any[];
      expect(cancelledBooking[0].hizmet_durumu).toBe('iptal');
      expect(cancelledBooking[0].erteleme_iptal_zamani).toBeTruthy();
    });

    it('should handle double cancel idempotently', async () => {
      // Create a future booking
      const bookingId = 12346;
      await prisma.$executeRaw`
        INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
        VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-25', '15:00', '60', 'aktif', 'Jane Smith', '555-0456', NOW(), NOW())
      `;

      // First cancel
      const response1 = await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          bookingId
        });

      expect(response1.status).toBe(200);

      // Second cancel (should be idempotent)
      const response2 = await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          bookingId
        });

      expect(response2.status).toBe(200);
      expect(response2.body.message).toBe('Booking is already cancelled.');
    });

    it('should reject cancellation of past bookings', async () => {
      // Create a past booking
      const bookingId = 12347;
      await prisma.$executeRaw`
        INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
        VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-10', '10:00', '60', 'aktif', 'Past Customer', '555-0789', NOW(), NOW())
      `;

      const response = await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          bookingId
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot cancel past bookings.');
    });

    it('should return 404 for non-existent booking', async () => {
      const response = await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          bookingId: 99999
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Booking not found.');
    });

    it('should validate bookingId parameter', async () => {
      const response = await request(app)
        .post('/api/bookings/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          // Missing bookingId
        });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Valid bookingId is required.');
  });
});

describe('POST /api/bookings/reschedule', () => {
  it('should reschedule a future booking successfully', async () => {
    // Create a future booking
    const bookingId = 12348;
    await prisma.$executeRaw`
      INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
      VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-25', '14:00', '60', 'aktif', 'Reschedule Customer', '555-0124', NOW(), NOW())
    `;

    const response = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId,
        newSlot: {
          date: '2024-01-25',
          startTime: '15:00',
          serviceId,
          staffIds: [staffId],
          peopleCount: 1
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Booking rescheduled successfully.');
    expect(response.body.oldBookingId).toBe(bookingId);
    expect(response.body.newAppointments).toHaveLength(1);

    // Verify old booking was cancelled
    const oldBooking = await prisma.$queryRaw`
      SELECT * FROM randevular WHERE id = ${bookingId}
    ` as any[];
    expect(oldBooking[0].hizmet_durumu).toBe('iptal');
    expect(oldBooking[0].erteleme_iptal_zamani).toBeTruthy();

    // Verify new appointment was created
    const newAppointments = await prisma.appointment.findMany({
      where: { salonId, source: 'ADMIN' }
    });
    expect(newAppointments.length).toBeGreaterThan(0);
  });

  it('should return 409 when new slot is not available', async () => {
    // Create a future booking
    const bookingId = 12349;
    await prisma.$executeRaw`
      INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
      VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-25', '14:00', '60', 'aktif', 'Conflict Customer', '555-0125', NOW(), NOW())
    `;

    // Create a conflicting appointment at the new time
    await prisma.appointment.create({
      data: {
        salonId,
        staffId,
        serviceId,
        customerName: 'Existing Customer',
        customerPhone: '555-0000',
        startTime: new Date('2024-01-25T15:00:00'),
        endTime: new Date('2024-01-25T16:00:00'),
        status: 'BOOKED'
      }
    });

    const response = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId,
        newSlot: {
          date: '2024-01-25',
          startTime: '15:00',
          serviceId,
          staffIds: [staffId],
          peopleCount: 1
        }
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('New slot is not available.');

    // Verify old booking was not modified
    const oldBooking = await prisma.$queryRaw`
      SELECT * FROM randevular WHERE id = ${bookingId}
    ` as any[];
    expect(oldBooking[0].hizmet_durumu).toBe('aktif');
  });

  it('should reject reschedule of past bookings', async () => {
    // Create a past booking
    const bookingId = 12350;
    await prisma.$executeRaw`
      INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
      VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-10', '10:00', '60', 'aktif', 'Past Customer', '555-0126', NOW(), NOW())
    `;

    const response = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId,
        newSlot: {
          date: '2024-01-25',
          startTime: '15:00',
          serviceId,
          staffIds: [staffId],
          peopleCount: 1
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Cannot reschedule past bookings.');
  });

  it('should handle double reschedule idempotently', async () => {
    // Create a future booking
    const bookingId = 12351;
    await prisma.$executeRaw`
      INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
      VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-25', '14:00', '60', 'aktif', 'Double Reschedule', '555-0127', NOW(), NOW())
    `;

    // First reschedule
    const response1 = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId,
        newSlot: {
          date: '2024-01-25',
          startTime: '16:00',
          serviceId,
          staffIds: [staffId],
          peopleCount: 1
        }
      });

    expect(response1.status).toBe(200);

    // Second reschedule attempt (should fail because booking is now cancelled)
    const response2 = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId,
        newSlot: {
          date: '2024-01-25',
          startTime: '17:00',
          serviceId,
          staffIds: [staffId],
          peopleCount: 1
        }
      });

    expect(response2.status).toBe(400);
    expect(response2.body.message).toBe('Cannot reschedule a cancelled booking.');
  });

  it('should return 404 for non-existent booking', async () => {
    const response = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId: 99999,
        newSlot: {
          date: '2024-01-25',
          startTime: '15:00',
          serviceId,
          staffIds: [staffId],
          peopleCount: 1
        }
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Booking not found.');
  });

  it('should validate required fields', async () => {
    const response = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        // Missing newSlot
        bookingId: 12345
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Missing or invalid required fields.');
  });

  it('should support multi-person rescheduling', async () => {
    // Create additional staff
    const staff2 = await prisma.staff.create({
      data: {
        salonId,
        name: 'Test Staff 3'
      }
    });

    // Create a future booking
    const bookingId = 12352;
    await prisma.$executeRaw`
      INSERT INTO randevular (id, salon_id, calisan_id, tarih, saat, sure, hizmet_durumu, musteri_adi, musteri_telefonu, created_at, updated_at)
      VALUES (${bookingId}, ${salonId}, ${staffId}, '2024-01-25', '14:00', '60', 'aktif', 'Multi Person', '555-0128', NOW(), NOW())
    `;

    const response = await request(app)
      .post('/api/bookings/reschedule')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        bookingId,
        newSlot: {
          date: '2024-01-25',
          startTime: '15:00',
          serviceId,
          staffIds: [staffId, staff2.id],
          peopleCount: 2
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.newAppointments).toHaveLength(2);

    // Verify both appointments were created
    const newAppointments = await prisma.appointment.findMany({
      where: { salonId, source: 'ADMIN' }
    });
    expect(newAppointments.length).toBeGreaterThanOrEqual(2);
  });
});
});
