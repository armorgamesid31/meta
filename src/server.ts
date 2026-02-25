import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import salonRoutes from './routes/salon.js';
import bookingRoutes from './routes/bookings.js';
import availabilityRoutes from './routes/availability.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import bookingContextRoutes from './routes/bookingContext.js';
import { multiTenantMiddleware } from './middleware/multiTenant.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for reverse proxy setups (Coolify/Traefik)
app.set('trust proxy', 1);

// Dynamic CORS configuration - Debug mode enabled
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // console.log('CORS Origin Check:', origin); // Debug log
    if (!origin) return callback(null, true);

    const baseDomain = 'kedyapp.com';
    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      // Strict check for production security
      const isAllowed = hostname === baseDomain ||
                        hostname.endsWith(`.${baseDomain}`) ||
                        hostname === 'localhost' ||
                        hostname === '127.0.0.1';

      if (isAllowed) {
        callback(null, origin); // FIX: Return the exact origin to echo it in Access-Control-Allow-Origin
      } else {
        // Return explicit error for debugging instead of silent failure
        console.warn(`Blocked CORS origin: ${origin}`);
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    } catch (e) {
      console.error(`Invalid Origin header: ${origin}`);
      callback(new Error('Invalid Origin'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// 1. CRITICAL: Pre-flight OPTIONS handling and CORS must be first
app.use(cors(corsOptions));

// 2. Health endpoint (Before tenant middleware)
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 3. Apply tenant middleware to API routes
// Note: We apply it globally to /api paths to ensure consistency
app.use('/api', multiTenantMiddleware);

// API Routes
app.use('/auth', authRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/booking', bookingContextRoutes);
app.use('/availability', multiTenantMiddleware, availabilityRoutes);
app.use('/appointments', multiTenantMiddleware, bookingRoutes);

// Debug routes
app.get('/debug/db-check', async (req, res) => {
  try {
    const salons = await prisma.salon.findMany({ select: { id: true, slug: true } });
    res.json({ count: salons.length, salons });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Serve static files from the React app build directory
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Catch all handler
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/auth/') ||
      req.path.startsWith('/availability/') ||
      req.path.startsWith('/appointments/') ||
      req.path.startsWith('/health')) {
    // Ensure API 404s return JSON, not HTML
    return res.status(404).json({ message: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT === '8080' ? 3000 : (Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});

export default app;