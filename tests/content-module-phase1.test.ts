import { ContentSurface, ContentValueStatus, UserRole } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    salon: {
      findUnique: vi.fn(),
    },
    salonUser: {
      findUnique: vi.fn(),
    },
    contentItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    contentLocaleValue: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  authenticateToken: vi.fn(),
  resolveRuntimeContent: vi.fn(),
  saveDraftValue: vi.fn(),
  publishLocaleValue: vi.fn(),
  publishLocaleValueBulk: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: mocks.prisma,
}));

vi.mock('../src/middleware/auth.js', () => ({
  authenticateToken: (...args: any[]) => mocks.authenticateToken(...args),
}));

vi.mock('../src/services/content.js', () => ({
  resolveRuntimeContent: (...args: any[]) => mocks.resolveRuntimeContent(...args),
  saveDraftValue: (...args: any[]) => mocks.saveDraftValue(...args),
  publishLocaleValue: (...args: any[]) => mocks.publishLocaleValue(...args),
  publishLocaleValueBulk: (...args: any[]) => mocks.publishLocaleValueBulk(...args),
}));

import adminContentRoutes from '../src/routes/adminContent.js';
import contentRoutes from '../src/routes/content.js';

function buildApp(basePath: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return app;
}

describe('Content module phase-1 routes', () => {
  const runtimeApp = buildApp('/api/content', contentRoutes);
  const adminApp = buildApp('/api/admin/content', adminContentRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONTENT_ADMIN_EMAILS = '';

    mocks.authenticateToken.mockImplementation((req: any, res: any, next: any) => {
      const auth = req.headers.authorization;
      if (!auth) {
        return res.sendStatus(401);
      }
      if (auth === 'Bearer invalid') {
        return res.sendStatus(403);
      }

      req.user = { userId: 11, salonId: 22, role: UserRole.OWNER };
      next();
    });

    mocks.prisma.salonUser.findUnique.mockResolvedValue({
      id: 11,
      salonId: 22,
      email: 'owner@test.local',
    });

    mocks.prisma.contentItem.findUnique.mockResolvedValue({
      id: 101,
      surface: ContentSurface.salon_website,
      page: 'home',
      section: 'hero',
      key: 'title',
      salonId: 22,
    });

    mocks.prisma.contentLocaleValue.findUnique.mockResolvedValue({
      id: 301,
      itemId: 101,
      locale: 'tr',
      draftValue: 'Updated draft v2',
      publishedValue: null,
      status: ContentValueStatus.DRAFT,
      version: 1,
      item: {
        id: 101,
        surface: ContentSurface.salon_website,
        salonId: 22,
      },
    });

    mocks.saveDraftValue.mockResolvedValue({
      item: {
        id: 101,
        surface: ContentSurface.salon_website,
        page: 'home',
        section: 'hero',
        key: 'title',
        salonId: 22,
      },
      localeValue: {
        id: 301,
        itemId: 101,
        locale: 'tr',
        draftValue: 'Updated draft v2',
        publishedValue: null,
        status: ContentValueStatus.DRAFT,
        version: 1,
      },
    });

    mocks.publishLocaleValue.mockResolvedValue({
      id: 301,
      itemId: 101,
      locale: 'tr',
      draftValue: 'Updated draft v2',
      publishedValue: 'Updated draft v2',
      status: ContentValueStatus.PUBLISHED,
      version: 2,
      publishedBy: 11,
      publishedAt: new Date('2026-03-23T00:00:00.000Z'),
    });

    mocks.resolveRuntimeContent.mockResolvedValue({
      surface: ContentSurface.booking_page,
      page: 'booking_dashboard',
      requestedLocale: 'de',
      fallbackLocale: 'en',
      salonId: 22,
      values: {
        'hero.title': 'Global TR Hero',
        'common.cta': 'Salon EN CTA',
      },
      meta: {
        'hero.title': { locale: 'tr', version: 1, source: 'global', itemId: 1 },
        'common.cta': { locale: 'en', version: 3, source: 'salon', itemId: 2 },
      },
    });
  });

  describe('GET /api/content/runtime', () => {
    it('returns runtime values and preserves fallback metadata', async () => {
      const response = await request(runtimeApp)
        .get('/api/content/runtime')
        .query({
          surface: ContentSurface.booking_page,
          page: 'booking_dashboard',
          locale: 'de',
          fallbackLocale: 'en',
          salonId: 22,
        });

      expect(response.status).toBe(200);
      expect(response.body.requestedLocale).toBe('de');
      expect(response.body.fallbackLocale).toBe('en');
      expect(response.body.values['common.cta']).toBe('Salon EN CTA');
      expect(response.body.meta['hero.title']).toMatchObject({ locale: 'tr', source: 'global' });
      expect(response.headers['cache-control']).toContain('max-age=60');

      expect(mocks.resolveRuntimeContent).toHaveBeenCalledWith({
        surface: ContentSurface.booking_page,
        page: 'booking_dashboard',
        locale: 'de',
        fallbackLocale: 'en',
        salonId: 22,
      });
    });

    it('normalizes unsupported locales to tr before resolving', async () => {
      await request(runtimeApp)
        .get('/api/content/runtime')
        .query({
          surface: ContentSurface.booking_page,
          page: 'booking_dashboard',
          locale: 'xx',
          fallbackLocale: 'yy',
          salonId: 22,
        });

      expect(mocks.resolveRuntimeContent).toHaveBeenCalledWith(
        expect.objectContaining({
          locale: 'tr',
          fallbackLocale: 'tr',
        }),
      );
    });
  });

  describe('POST /api/admin/content/items/draft', () => {
    it('enforces auth guard basics (missing token => 401)', async () => {
      const response = await request(adminApp)
        .post('/api/admin/content/items/draft')
        .send({
          itemId: 101,
          locale: 'tr',
          draftValue: 'Updated draft',
        });

      expect(response.status).toBe(401);
      expect(mocks.saveDraftValue).not.toHaveBeenCalled();
    });

    it('saves draft for existing item in DRAFT status', async () => {
      const response = await request(adminApp)
        .post('/api/admin/content/items/draft')
        .set('Authorization', 'Bearer valid')
        .send({
          itemId: 101,
          locale: 'tr',
          draftValue: 'Updated draft v2',
        });

      expect(response.status).toBe(200);
      expect(response.body.localeValue).toMatchObject({
        locale: 'tr',
        draftValue: 'Updated draft v2',
        status: ContentValueStatus.DRAFT,
      });
      expect(mocks.saveDraftValue).toHaveBeenCalledWith({
        surface: ContentSurface.salon_website,
        page: 'home',
        section: 'hero',
        key: 'title',
        locale: 'tr',
        draftValue: 'Updated draft v2',
        salonId: 22,
        metadata: undefined,
      });
    });
  });

  describe('POST /api/admin/content/items/publish', () => {
    it('publishes draft and records publisher', async () => {
      const response = await request(adminApp)
        .post('/api/admin/content/items/publish')
        .set('Authorization', 'Bearer valid')
        .send({ itemId: 101, locale: 'tr' });

      expect(response.status).toBe(200);
      expect(response.body.localeValue).toMatchObject({
        itemId: 101,
        locale: 'tr',
        status: ContentValueStatus.PUBLISHED,
        version: 2,
        publishedBy: 11,
      });
      expect(mocks.publishLocaleValue).toHaveBeenCalledWith({
        itemId: 101,
        locale: 'tr',
        publishedBy: 11,
      });
    });
  });
});
