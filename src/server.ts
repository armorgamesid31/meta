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

app.set('trust proxy', 1);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const baseDomain = 'kedyapp.com';
    try {
      const url = new URL(origin);
      const hostname = url.hostname;
      const isAllowed = hostname === baseDomain || hostname.endsWith(`.${baseDomain}`) || hostname === 'localhost' || hostname === '127.0.0.1';
      if (isAllowed) callback(null, origin);
      else callback(null, false);
    } catch (e) {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Admin/System debug routes (no tenant needed)
app.get('/debug/db-check', async (req, res) => {
  try {
    const salons = await prisma.salon.findMany({ select: { id: true, slug: true } });
    res.json({ count: salons.length, salons });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Apply tenant middleware to ALL other API routes
app.use(multiTenantMiddleware);

app.use('/auth', authRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/booking', bookingContextRoutes);
app.use('/availability', availabilityRoutes);
app.use('/appointments', bookingRoutes);

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Use a catch-all route compatible with newer path-to-regexp (regex or (.*))
app.get('/*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/availability/')) {
    return res.status(404).json({ message: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// Final Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Final Error Catch:', err);
  res.status(err.status || 500).json({ 
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : undefined
  });
});

const PORT = (Number(process.env.PORT) || 3000);
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});

export default app;
