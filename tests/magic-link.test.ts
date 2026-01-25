import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/server.js';
import { prisma } from '../src/prisma.js';

describe('Magic Link System', () => {
  let testSalon: any;

  beforeAll(async () => {
    // Create test salon
    testSalon = await prisma.salon.create({
      data: { name: 'Test Salon Magic Links' }
    });
  });

  afterAll(async () => {
    // Clean up
    await prisma.magicLink.deleteMany();
    await prisma.customer.deleteMany({ where: { salonId: testSalon.id } });
    await prisma.salon.delete({ where: { id: testSalon.id } });
  });

  describe('POST /api/magic-link/create', () => {
    it('should create a booking magic link', async () => {
      const response = await request(app)
        .post('/api/magic-link/create')
        .send({
          phone: '+905551234567',
          type: 'BOOKING',
          salonId: testSalon.id
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('magicUrl');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body.type).toBe('BOOKING');
    });

    it('should reject invalid type', async () => {
      const response = await request(app)
        .post('/api/magic-link/create')
        .send({
          phone: '+905551234567',
          type: 'INVALID',
          salonId: testSalon.id
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid type');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/magic-link/create')
        .send({
          phone: '+905551234567'
          // missing type and salonId
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /m/:token', () => {
    let testToken: string;

    beforeAll(async () => {
      // Create a test magic link
      const response = await request(app)
        .post('/api/magic-link/create')
        .send({
          phone: '+905551234568',
          type: 'BOOKING',
          salonId: testSalon.id
        });

      testToken = response.body.token;
    });

    it('should resolve valid magic link', async () => {
      const response = await request(app)
        .get(`/m/${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('BOOKING');
      expect(response.body.phone).toBe('+905551234568');
      expect(response.body).toHaveProperty('customer');
    });

    it('should return 404 for non-existent token', async () => {
      const response = await request(app)
        .get('/m/nonexistenttoken');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Magic link not found');
    });
  });

  describe('POST /m/:token/complete', () => {
    let testToken: string;

    beforeAll(async () => {
      // Create a test magic link
      const response = await request(app)
        .post('/api/magic-link/create')
        .send({
          phone: '+905551234569',
          type: 'BOOKING',
          salonId: testSalon.id
        });

      testToken = response.body.token;
    });

    it('should mark magic link as used', async () => {
      const response = await request(app)
        .post(`/m/${testToken}/complete`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Magic link marked as used');
      expect(response.body).toHaveProperty('usedAt');
    });
  });
});