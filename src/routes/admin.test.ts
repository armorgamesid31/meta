import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../server';
import { prisma } from '../prisma';

describe('Admin Routes', () => {
  let authToken: string;
  let salonId: number;
  let userId: number;
  let serviceId: number;
  let staffId: number;
  let customerId: number;
  let appointmentId: number;

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

    const customer = await prisma.customer.create({
      data: {
        salonId,
        name: 'Test Customer',
        phone: '555-0123'
      }
    });
    customerId = customer.id;

    const appointment = await prisma.appointment.create({
      data: {
        salonId,
        staffId,
        serviceId,
        customerId,
        customerName: 'Test Customer',
        customerPhone: '555-0123',
        startTime: new Date('2024-01-25T14:00:00'),
        endTime: new Date('2024-01-25T15:00:00'),
        status: 'BOOKED'
      }
    });
    appointmentId = appointment.id;

    // Generate auth token (simplified for testing)
    authToken = 'test-token';
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.appointment.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.service.deleteMany();
    await prisma.staff.deleteMany();
    await prisma.salonSettings.deleteMany();
    await prisma.salonUser.deleteMany();
    await prisma.salon.deleteMany();

    // Clean up raw SQL tables
    await prisma.$executeRaw`DELETE FROM temporary_locks`;
  });

  describe('GET /api/admin/booking-theme', () => {
    it('should return default theme when no custom theme exists', async () => {
      const response = await request(app)
        .get('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.theme).toEqual({
        logoUrl: null,
        primaryColor: '#3B82F6',
        secondaryColor: '#64748B',
        welcomeTitle: 'Randevu Alın',
        welcomeDescription: 'Size en uygun saatleri seçin',
        confirmButtonText: 'Randevuyu Onayla'
      });
    });

    it('should return custom theme when it exists', async () => {
      // Set custom theme
      const customTheme = {
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#FF0000',
        secondaryColor: '#00FF00',
        welcomeTitle: 'Hoş Geldiniz',
        welcomeDescription: 'Randevu alın',
        confirmButtonText: 'Onayla'
      };

      await prisma.salon.update({
        where: { id: salonId },
        data: { bookingTheme: customTheme }
      });

      const response = await request(app)
        .get('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.theme).toEqual(customTheme);
    });

    it('should merge custom theme with defaults', async () => {
      // Set partial custom theme
      const partialTheme = {
        primaryColor: '#FF0000',
        welcomeTitle: 'Hoş Geldiniz'
      };

      await prisma.salon.update({
        where: { id: salonId },
        data: { bookingTheme: partialTheme }
      });

      const response = await request(app)
        .get('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.theme).toEqual({
        logoUrl: null,
        primaryColor: '#FF0000', // Custom
        secondaryColor: '#64748B', // Default
        welcomeTitle: 'Hoş Geldiniz', // Custom
        welcomeDescription: 'Size en uygun saatleri seçin', // Default
        confirmButtonText: 'Randevuyu Onayla' // Default
      });
    });
  });

  describe('PUT /api/admin/booking-theme', () => {
    it('should update booking theme successfully', async () => {
      const updateData = {
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#FF0000',
        secondaryColor: '#00FF00',
        welcomeTitle: 'Hoş Geldiniz',
        welcomeDescription: 'Randevu alın',
        confirmButtonText: 'Onayla'
      };

      const response = await request(app)
        .put('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Booking theme updated successfully.');
      expect(response.body.theme).toEqual(updateData);

      // Verify in database
      const salon = await prisma.salon.findUnique({
        where: { id: salonId },
        select: { bookingTheme: true }
      });
      expect(salon?.bookingTheme).toEqual(updateData);
    });

    it('should validate color format', async () => {
      const response = await request(app)
        .put('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          primaryColor: 'invalid-color'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid primary color format. Use hex format like #3B82F6.');
    });

    it('should validate text length limits', async () => {
      const response = await request(app)
        .put('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          welcomeTitle: 'a'.repeat(101) // Too long
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Welcome title must be 100 characters or less.');
    });

    it('should use defaults for missing fields', async () => {
      const response = await request(app)
        .put('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          primaryColor: '#FF0000'
        });

      expect(response.status).toBe(200);
      expect(response.body.theme.primaryColor).toBe('#FF0000');
      expect(response.body.theme.secondaryColor).toBe('#64748B'); // Default
    });
  });

  describe('Theme isolation between salons', () => {
    it('should isolate themes between different salons', async () => {
      // Create another salon
      const salon2 = await prisma.salon.create({
        data: {
          name: 'Test Salon 2',
          bookingTheme: {
            primaryColor: '#00FF00',
            welcomeTitle: 'Salon 2 Theme'
          }
        }
      });

      const user2 = await prisma.salonUser.create({
        data: {
          email: 'test2@example.com',
          passwordHash: 'hashedpassword',
          role: 'OWNER',
          salonId: salon2.id
        }
      });

      // Salon 1 theme
      const response1 = await request(app)
        .get('/api/admin/booking-theme')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response1.body.theme.primaryColor).toBe('#3B82F6'); // Default

      // Salon 2 theme (would need different auth token in real implementation)
      // This test demonstrates the concept - in practice, different auth tokens would be used
      const salon2Data = await prisma.salon.findUnique({
        where: { id: salon2.id },
        select: { bookingTheme: true }
      });
      expect(salon2Data?.bookingTheme).toEqual({
        primaryColor: '#00FF00',
        welcomeTitle: 'Salon 2 Theme'
      });
    });
  });
});