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
    if (!origin) return callback(null, true);
    const baseDomain = 'kedyapp.com';
    try {
      const url = new URL(origin);
      const hostname = url.hostname;
      const isAllowed = hostname === baseDomain || hostname.endsWith(`.${baseDomain}`) || hostname === 'localhost' || hostname === '127.0.0.1';
      if (isAllowed) callback(null, true);
      else callback(new Error('Not allowed by CORS'));
    } catch (e) {
      callback(new Error('Invalid Origin'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
};

app.use(cors(corsOptions));

// 1. Health endpoint (Before tenant middleware)
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 2. API Routes (Before static files)
app.use('/auth', authRoutes);
app.use('/api/salon', multiTenantMiddleware, salonRoutes);
app.use('/api/bookings', multiTenantMiddleware, bookingRoutes);
app.use('/api/customers', multiTenantMiddleware, customerRoutes);
app.use('/api/booking', multiTenantMiddleware, bookingContextRoutes);
app.use('/availability', multiTenantMiddleware, availabilityRoutes);
app.use('/appointments', multiTenantMiddleware, bookingRoutes);

// 3. Debug routes
app.get('/debug/db-check', async (req, res) => {
  try {
    const salons = await prisma.salon.findMany({ select: { id: true, slug: true } });
    res.json({ count: salons.length, salons });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 4. Serve static files from React build
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// 5. Catch-all: Send index.html for React Router
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/availability/')) {
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
