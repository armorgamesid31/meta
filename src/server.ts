import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import salonRoutes from './routes/salon.js';
import salonsRoutes from './routes/salons.js';
import categoriesRoutes from './routes/categories.js';
import seoRoutes from './routes/seo.js';
import translationsRoutes from './routes/translations.js';
import bookingRoutes from './routes/bookings.js';
import availabilityRoutes from './routes/availability.js';
import authRoutes from './routes/auth.js';
import adminMobileRoutes from './routes/adminMobile.js';
import adminAccessRoutes from './routes/adminAccess.js';
import adminImportsRoutes from './routes/adminImports.js';
import adminContentRoutes from './routes/adminContent.js';
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
import internalAgentOutboundRoutes from './routes/internalAgentOutbound.js';
import internalImportsRoutes from './routes/internalImports.js';
import internalWebsiteRoutes from './routes/internalWebsite.js';
import channelWebhooksRoutes from './routes/channelWebhooks.js';
import { multiTenantMiddleware } from './middleware/multiTenant.js';
import { authenticateToken } from './middleware/auth.js';
import { requireAdminRoutePermission } from './middleware/access.js';
import { requirePermissionKey } from './middleware/access.js';
import { requireInternalApiKey } from './middleware/internal.js';
import { ensurePermissionCatalog } from './services/accessControl.js';
import { startNotificationJobs } from './services/notifications.js';
import { startImportRetentionJob } from './services/importWizard.js';
import { createServer } from 'http';
import { initConversationEventsBus } from './services/conversationEventsBus.js';
import { initConversationRealtimeWebSocketServer } from './services/conversationRealtimeWs.js';

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
app.use((req, res, next) => {
  if (req.originalUrl.includes('/website/generate')) {
    console.log(`[GLOBAL_DEBUG] Incoming ${req.method} to ${req.originalUrl} from ${req.ip}`);
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", async (_req, res) => {
  try {
    // Check Database Connectivity
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ 
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0"
    });
  } catch (error) {
    res.status(503).json({ 
      status: "unhealthy", 
      database: "disconnected",
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
app.use('/api/internal/agent-outbound', internalAgentOutboundRoutes);
app.use('/api/internal/imports', internalImportsRoutes);
app.use('/api/internal/website', internalWebsiteRoutes);
app.use('/api/webhooks', channelWebhooksRoutes);

// Apply tenant middleware to ALL other API routes
app.use(multiTenantMiddleware);

app.use('/auth', authRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/admin/content', adminContentRoutes);
app.use('/api/admin/access', adminAccessRoutes);
app.use('/api/admin/imports', authenticateToken, requirePermissionKey('imports.manage'), adminImportsRoutes);
app.use('/api/admin', authenticateToken, requireAdminRoutePermission, adminMobileRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/internal/service-translations', internalServiceTranslationsRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/salons', salonsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/translations', translationsRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/booking', bookingContextRoutes);
app.use('/api/waitlist', waitlistRoutes);
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

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Final Error Catch:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error"
  });
});

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
});
export default app;
