import dotenv from 'dotenv';
dotenv.config();
// Sentry MUST be imported/initialized before any other modules that may throw
import './lib/sentry.js';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import salonRoutes from './routes/salon.js';
import salonTemplateStatusRoutes from './routes/salonTemplateStatus.js';
import redirectRoutes from './routes/redirects.js';
import magicLinkLandingRoutes from './routes/magicLinkLanding.js';
import salonsRoutes from './routes/salons.js';
import categoriesRoutes from './routes/categories.js';
import seoRoutes from './routes/seo.js';
import translationsRoutes from './routes/translations.js';
import bookingRoutes from './routes/bookings.js';
import availabilityRoutes from './routes/availability.js';
import authRoutes from './routes/auth.js';
import verificationRoutes from './routes/verification.js';
import feedbackRoutes from './routes/feedback.js';
import adminMobileRoutes from './routes/adminMobile.js';
import conversationMediaRoutes from './routes/conversationMedia.js';
import adminAccessRoutes from './routes/adminAccess.js';
import adminImportsRoutes from './routes/adminImports.js';
import adminContentRoutes from './routes/adminContent.js';
import onboardingRoutes from './routes/onboarding.js';
import salonLogoRoutes, { logoErrorHandler } from './routes/salonLogo.js';
import galleryRoutes, { galleryErrorHandler } from './routes/gallery.js';
import mobileRoutes from './routes/mobile.js';
import customerRoutes from './routes/customers.js';
import bookingContextRoutes from './routes/bookingContext.js';
import waitlistRoutes from './routes/waitlist.js';
import chakraRoutes from './routes/chakra.js';
import metaDirectRoutes from './routes/metaDirect.js';
import contentRoutes from './routes/content.js';
import internalServiceTranslationsRoutes from './routes/internalServiceTranslations.js';
import internalInboxIngestRoutes from './routes/internalInboxIngest.js';
import internalMagicLinkRoutes from './routes/internalMagicLink.js';
import internalConversationStateRoutes from './routes/internalConversationState.js';
import internalOutboundRoutes from './routes/internalOutbound.js';
import internalMessageEnrichmentRoutes from './routes/internalMessageEnrichment.js';
import internalAgentOutboundRoutes from './routes/internalAgentOutbound.js';
import internalAgentRoutes from './routes/internalAgent.js';
import internalImportsRoutes from './routes/internalImports.js';
import internalWebsiteRoutes from './routes/internalWebsite.js';
import channelWebhooksRoutes from './routes/channelWebhooks.js';
import internalBillingRoutes from './routes/internalBilling.js';
import internalLifecycleRoutes from './routes/internalLifecycle.js';
import billingRoutes from './routes/billing.js';
import checkoutRoutes from './routes/checkout.js';
import publicRoutes from './routes/public.js';
import { processStripeWebhook } from './services/stripeBilling.js';
import { multiTenantMiddleware } from './middleware/multiTenant.js';
import { authenticateToken } from './middleware/auth.js';
import { requireAdminRoutePermission } from './middleware/access.js';
import { requirePermissionKey } from './middleware/access.js';
import { requireInternalApiKey } from './middleware/internal.js';
import { ensurePermissionCatalog } from './services/accessControl.js';
import { startNotificationJobs } from './services/notifications.js';
import { startImportRetentionJob } from './services/importWizard.js';
import { startSubmissionWorker } from './services/salonTemplateSubmitter.js';
import { startBackgroundJobs } from './jobs/index.js';
import { createServer } from 'http';
import { initConversationEventsBus } from './services/conversationEventsBus.js';
import { initConversationRealtimeWebSocketServer } from './services/conversationRealtimeWs.js';
import { traceMiddleware } from './middleware/trace.js';
import { errorMiddleware } from './middleware/error.js';
import { accessLogMiddleware } from './middleware/accessLog.js';
import { authRateLimiter, apiRateLimiter } from './middleware/rateLimit.js';
import { BusinessError } from './lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);

const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const frontendOrigin = process.env.FRONTEND_URL || '';

function extractRootDomain(hostname: string): string | null {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    for (const rule of configuredOrigins) {
      const normalized = rule.toLowerCase();
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        continue;
      }

      const parsedRule = new URL(normalized);
      const ruleHost = parsedRule.hostname;

      if (ruleHost.startsWith('*.')) {
        const suffix = ruleHost.slice(2);
        if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
          return true;
        }
      } else if (hostname === ruleHost) {
        return true;
      }
    }

    if (frontendOrigin) {
      const parsedFrontend = new URL(frontendOrigin);
      const frontendHost = parsedFrontend.hostname.toLowerCase();
      const frontendRoot = extractRootDomain(frontendHost);

      if (hostname === frontendHost) {
        return true;
      }
      if (frontendRoot && (hostname === frontendRoot || hostname.endsWith(`.${frontendRoot}`))) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-salon-id',
    'x-tenant-slug',
    'x-internal-api-key',
  ],
};

app.use(cors(corsOptions));
app.use(traceMiddleware);
app.use(accessLogMiddleware);

app.post('/api/billing/stripe/webhook', express.raw({ type: 'application/json' }), async (req: any, res) => {
  const signature = String(req.headers['stripe-signature'] || '').trim();
  if (!signature) {
    return res.status(400).json({ message: 'Missing stripe-signature header.' });
  }
  try {
    const result = await processStripeWebhook(req.body, signature);
    return res.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    console.error('Stripe webhook processing failed:', error);
    return res.status(400).json({ message: error?.message || 'Webhook verification failed.' });
  }
});

app.use((req, res, next) => {
  if (req.originalUrl.includes('/website/generate')) {
    console.log(`[GLOBAL_DEBUG] Incoming ${req.method} to ${req.originalUrl} from ${req.ip}`);
  }
  next();
});

// Meta/IG/WhatsApp webhooks need the raw body for X-Hub-Signature-256 HMAC
// verification. Mount raw parser BEFORE express.json() so the JSON parser
// does not consume the buffer. The webhook route's verifyMetaSignature
// middleware parses JSON after verifying the signature. Only POST is raw —
// GET (verification challenge) does not have a body.
app.use('/api/webhooks', (req, res, next) => {
  if (req.method !== 'POST') return next();
  return express.raw({ type: 'application/json', limit: '10mb' })(req, res, next);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", async (_req, res) => {
  const startedAt = Date.now();
  try {
    // Check Database Connectivity
    const dbStartedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - dbStartedAt;
    const dbStatus = dbLatencyMs > 800 ? 'degraded' : 'healthy';
    res.status(200).json({ 
      status: "healthy",
      database: "connected",
      dbStatus,
      dbLatencyMs,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0"
    });
  } catch (error) {
    res.status(503).json({ 
      status: "unhealthy", 
      database: "disconnected",
      latencyMs: Date.now() - startedAt,
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin/System debug routes (no tenant needed) - Restricted to development
if (process.env.NODE_ENV !== 'production') {
  app.get("/debug/db-check", async (req, res) => {
    try {
      const salons = await prisma.salon.findMany({ select: { id: true, slug: true } });
      res.json({ count: salons.length, salons });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

if (process.env.NODE_ENV !== 'production') {
  app.post("/api/internal/chakra/webhook", (req, res) => {
    console.log("--- CHAKRA WEBHOOK RECEIVED ---");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);
    // Always return 200 OK to prevent webhook retry loops during debugging
    res.status(200).send("OK");
  });
}

// Internal API routes (secured by X-Internal-API-Key)
app.use('/api/internal', requireInternalApiKey);

app.use('/api/internal/inbox', internalInboxIngestRoutes);
app.use('/api/internal/magic-link', internalMagicLinkRoutes);
app.use('/api/internal/conversation-state', internalConversationStateRoutes);
app.use('/api/internal/outbound', internalOutboundRoutes);
app.use('/api/internal', internalMessageEnrichmentRoutes);
app.use('/api/internal/agent-outbound', internalAgentOutboundRoutes);
app.use('/api/internal/agent', internalAgentRoutes);
app.use('/api/internal/imports', internalImportsRoutes);
app.use('/api/internal/website', internalWebsiteRoutes);
app.use('/api/internal/billing', internalBillingRoutes);
app.use('/api/internal/lifecycle', internalLifecycleRoutes);
app.use('/api/webhooks', channelWebhooksRoutes);

// Apply tenant middleware to ALL other API routes
app.use(multiTenantMiddleware);

// Strict rate limit on credential / verification endpoints (login,
// refresh, register, code verification). Mounted before the routers
// so the limiter runs first.
app.use('/auth', authRateLimiter);
app.use('/api/auth', authRateLimiter);
app.use('/api/customers/register', authRateLimiter);
app.use('/api/customers/verify', authRateLimiter);
app.use('/api/customers/resend-code', authRateLimiter);
// Slug-existence probe is cheap to fan out but enables salon-enumeration if
// hit unthrottled. Same 10/min budget as auth endpoints.
app.use('/api/salon/slug-available', authRateLimiter);

// Loose limiter for the rest of /api traffic.
app.use('/api', apiRateLimiter);

app.use('/auth', authRoutes);
app.use('/auth', verificationRoutes);
// Frontend (F7 switcher and other newer clients) calls /api/auth/* — mount the
// same routers at the namespaced prefix as well. /auth/* stays for legacy.
app.use('/api/auth', authRoutes);
app.use('/api/auth', verificationRoutes);
app.use('/api/mobile', mobileRoutes);
// Mount-level auth + permission gate. Routes inside also apply per-endpoint
// requirePermissionKey for granular checks (which stays idempotent), but the
// outer guarantee here prevents any new endpoint added inside the router from
// accidentally shipping public. requireAdminRoutePermission is no-op if the
// path doesn't map to a permission key, so routes without a mapping still
// work — they just require an authenticated session.
app.use('/api/admin/content', authenticateToken, requireAdminRoutePermission, adminContentRoutes);
app.use('/api/admin/access', authenticateToken, requireAdminRoutePermission, adminAccessRoutes);
app.use('/api/admin/imports', authenticateToken, requirePermissionKey('imports.manage'), adminImportsRoutes);
app.use('/api/admin/salon-logo', salonLogoRoutes, logoErrorHandler);
app.use('/api/admin/gallery', galleryRoutes, galleryErrorHandler);
app.use('/api/admin', authenticateToken, requireAdminRoutePermission, adminMobileRoutes);
// Conversation media read endpoints — mounted under /api/salon for parity
// with /templates routes (same auth surface). Outbound send endpoint lives
// here too once Stage 2 lands.
app.use('/api/salon', conversationMediaRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/internal/service-translations', internalServiceTranslationsRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/salon', salonTemplateStatusRoutes);
app.use('/r', redirectRoutes);
app.use('/v', magicLinkLandingRoutes);
app.use('/api/salons', salonsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/translations', translationsRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/booking', bookingContextRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/app/chakra', chakraRoutes);
app.use('/api/app/meta-direct', metaDirectRoutes);
app.use('/availability', availabilityRoutes);
app.use('/appointments', bookingRoutes);

// Chakra Test Page (Official SDK Replication) - Restricted to development
if (process.env.NODE_ENV !== 'production') {
  app.get('/chakratest', (req: any, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <title>Chakra SDK Official Test</title>
          <script src="https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js"></script>
          <style>
              body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f4f9; padding: 20px; }
              #container { padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 500px; width: 100%; }
              .btn { display: block; width: 100%; padding: 14px; margin: 10px 0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; background: #007bff; color: white; }
              #status { margin-top: 1.5rem; padding: 10px; border-radius: 4px; background: #eee; font-size: 0.85rem; }
          </style>
      </head>
      <body>
          <div id="container">
              <h1>Chakra SDK Official Test</h1>
              <button id="btn-init">Get Token & Init SDK</button>
              <div id="sdk-container" style="margin-top:20px; border:1px dashed #ccc; min-height:100px; padding:10px;">
                  SDK will load here...
              </div>
              <div id="status">Ready.</div>
          </div>
          <script>
              document.getElementById("btn-init").onclick = async () => {
                  const statusEl = document.getElementById("status");
                  const sdkContainer = document.getElementById("sdk-container");

                  statusEl.innerText = "Fetching token...";
                  try {
                      const res = await fetch("/api/app/chakra/connect-token");
                      const data = await res.json();
                      
                      if (!data.connectToken) throw new Error(data.message || "Token failed.");

                      statusEl.innerText = "Token received. Initializing SDK...";
                      
                      // Official SDK initialization
                      const chakraWhatsappConnect = window.ChakraWhatsappConnect.init({
                          connectToken: data.connectToken,
                          container: sdkContainer,
                          // No baseUrl needed as per latest docs
                          onMessage: (event, payload) => {
                              console.log("Chakra Event:", event, payload);
                              statusEl.innerText = "Event: " + event;
                          },
                          onReady: () => {
                              console.log("Chakra SDK Ready");
                              statusEl.innerText = "✅ SDK Initialized. Button should be visible.";
                          },
                          onError: (err) => {
                              console.error("Chakra Error:", err);
                              statusEl.innerText = "❌ SDK Error: " + (err.message || "Unknown");
                          }
                      });

                      // You can optionally store chakraWhatsappConnect to call its destroy method later
                      // window.chakraInstance = chakraWhatsappConnect;

                  } catch (err) {
                      statusEl.innerText = "❌ Error: " + err.message;
                      console.error(err);
                  }
              };
          </script>
      </body>
      </html>
    `);
  });
}

const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

app.get(/^(?!\/api|\/auth|\/availability|\/chakratest|\/api\/internal\/chakra\/webhook).*$/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Anything still unhandled (mostly unknown /api/* paths) becomes a structured 404
// rather than Express' default HTML page, so the frontend's ApiError sees the
// same { code, message, traceId } envelope as every other failure.
app.use('/api', (req, _res, next) => {
  next(new BusinessError('NOT_FOUND', `Endpoint bulunamadı: ${req.method} ${req.originalUrl}`, 404));
});

// Sentry error handler — must be mounted BEFORE the project's errorMiddleware
// so it can observe each error before the response is built. It is a passive
// observer; it does not modify the response.
Sentry.setupExpressErrorHandler(app);

app.use(errorMiddleware);

const PORT = (Number(process.env.PORT) || 3000);
const HOST = "0.0.0.0";
const server = createServer(app);
initConversationRealtimeWebSocketServer(server);

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
  initConversationEventsBus().catch((error) => {
    console.error('Conversation events bus init warning:', error);
  });
  ensurePermissionCatalog().catch((error) => {
    console.error('Access permission catalog bootstrap warning:', error);
  });
  startNotificationJobs();
  startImportRetentionJob();
  startSubmissionWorker();
  startBackgroundJobs();
});
export default app;
