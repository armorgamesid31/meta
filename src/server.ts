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

// Dynamic CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // If no origin (like server-to-server or tools), allow it
    if (!origin) {
      return callback(null, true);
    }

    const baseDomain = 'kedyapp.com';
    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      // Check if it's the base domain or any subdomain of kedyapp.com
      const isAllowed = hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
      
      if (isAllowed) {
        callback(null, true);
      } else {
        // Also allow local development origins if needed
        const localOrigins = ['localhost', '127.0.0.1'];
        if (localOrigins.some(loc => hostname === loc)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    } catch (e) {
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

// 2. Health endpoint (no tenant context required)
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// 3. Multi-tenant context extraction
app.use(multiTenantMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/auth', authRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/booking', bookingContextRoutes);
app.use('/availability', availabilityRoutes);
app.use('/appointments', bookingRoutes);

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
app.use(express.static(path.join(__dirname, '../dist')));

// Catch all handler
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/auth/') ||
      req.path.startsWith('/availability/') ||
      req.path.startsWith('/appointments/') ||
      req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const PORT = process.env.PORT === '8080' ? 3000 : (Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});

export default app;
