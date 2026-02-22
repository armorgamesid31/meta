import 'dotenv/config';

import express from 'express';

// Log DATABASE_URL at startup (mask password)
const dbUrl = process.env.DATABASE_URL || '';
const maskedDbUrl = dbUrl.replace(/:([^:@]{4})[^:@]*@/, ':$1****@');
console.log('DATABASE_URL:', maskedDbUrl);
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { prisma } from './prisma.js';
import { generateToken } from './utils/jwt.js';
import { UserRole } from '@prisma/client';
import salonRoutes from './routes/salon.js';
import bookingRoutes from './routes/bookings.js';
import availabilityRoutes from './routes/availability.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import bookingContextRoutes from './routes/bookingContext.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for reverse proxy setups (Coolify/Traefik)
app.set('trust proxy', 1);

// CRITICAL: Health endpoint MUST be defined BEFORE any middleware
app.get("/health", (_req, res) => {
  console.log('Health endpoint called - returning status: ok');
  res.status(200).json({ status: "ok" });
});

// Direct test route - also before middleware
app.get('/test-direct', (req, res) => {
  res.json({ message: 'Direct route working' });
});

// Debug DB check route
app.get('/debug/db-check', async (req, res) => {
  try {
    const salons = await prisma.salon.findMany({ select: { id: true } });
    res.json({ count: salons.length, ids: salons.map(s => s.id) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug salon check
app.get('/debug/salon/:id', async (req, res) => {
  try {
    const salon = await prisma.salon.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { id: true, name: true }
    });
    res.json(salon);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug service check
app.get('/debug/service/:id', async (req, res) => {
  try {
    const service = await prisma.service.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { id: true, name: true, salonId: true }
    });
    res.json(service);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug services for salon
app.get('/debug/services/:salonId', async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { salonId: parseInt(req.params.salonId) },
      select: { id: true, name: true, salonId: true }
    });
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug staff service check
app.get('/debug/staff-service/:serviceId/:salonId', async (req, res) => {
  try {
    // First check if service belongs to salon
    const service = await prisma.service.findUnique({
      where: { id: parseInt(req.params.serviceId) },
      select: { salonId: true }
    });

    if (!service || service.salonId !== parseInt(req.params.salonId)) {
      return res.json([]);
    }

    const staffServices = await prisma.staffService.findMany({
      where: { serviceId: parseInt(req.params.serviceId) },
      select: { id: true, staffId: true, serviceId: true }
    });
    res.json(staffServices);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug staff working hours
app.get('/debug/staff-hours/:serviceId/:salonId', async (req, res) => {
  try {
    // First check if service belongs to salon
    const service = await prisma.service.findUnique({
      where: { id: parseInt(req.params.serviceId) },
      select: { salonId: true }
    });

    if (!service || service.salonId !== parseInt(req.params.salonId)) {
      return res.json([]);
    }

    const staffIds = await prisma.staffService.findMany({
      where: { serviceId: parseInt(req.params.serviceId) },
      select: { staffId: true }
    });

    const hours = await prisma.staffWorkingHours.findMany({
      where: {
        staffId: { in: staffIds.map(s => s.staffId) }
      }
    });

    res.json(hours);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug service stats
app.get('/debug/service-stats/:serviceId', async (req, res) => {
  try {
    const stats = await prisma.serviceStats.findUnique({
      where: { serviceId: parseInt(req.params.serviceId) }
    });
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug staff for salon
app.get('/debug/staff/:salonId', async (req, res) => {
  try {
    const staff = await prisma.staff.findMany({
      where: { salonId: parseInt(req.params.salonId) },
      select: { id: true, name: true, salonId: true }
    });
    res.json(staff);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug all staff services
app.get('/debug/all-staff-services', async (req, res) => {
  try {
    const staffServices = await prisma.staffService.findMany({
      select: { id: true, staffId: true, serviceId: true }
    });
    res.json(staffServices);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Debug services with detailed data
app.get('/debug/services', async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      take: 10 // Limit for testing
    });

    res.json(services.map(service => ({
      id: service.id,
      name: service.name,
      salonId: service.salonId,
      categoryId: service.categoryId,
      requiresSpecialist: service.requiresSpecialist,
      price: service.price,
      duration: service.duration
    })));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});



// NOW apply middleware AFTER health endpoint
// Debug middleware - log all requests (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// Configure CORS for frontend access
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'https://localhost:5173'];

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

// Middleware to parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'OPTIONS') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Body:`, JSON.stringify(req.body, null, 2));
    }
    next();
  });
}

// Test POST route directly in server - after middleware
app.post('/test-auth-post', (req, res) => {
  res.json({ message: 'Server POST working', body: req.body });
});

// API routes
app.use('/auth', authRoutes);
// Core routes for booking functionality
app.use('/api/salon', salonRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/booking', bookingContextRoutes);
app.use('/availability', availabilityRoutes);
app.use('/appointments', bookingRoutes);

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, '../dist')));

// Basic test route (only for API testing, not served to frontend)
app.get("/", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
      <head>
        <meta charset="UTF-8" />
        <title>Salon Asistan</title>
      </head>
      <body>
        <h1>Salon Asistan Çalışıyor ✅</h1>
        <p>Sunucu canlı. Frontend bir sonraki adım.</p>
      </body>
    </html>
  `);
});

// Catch all handler: send back React's index.html file for client-side routing
// This must be the LAST middleware and only for non-API routes
app.use((req, res, next) => {
  // Skip API routes - let them fall through to 404 if not handled
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

console.log("PORT ENV:", process.env.PORT);

// Startup DB test
(async () => {
  try {
    await prisma.$connect();
    const salonCount = await prisma.salon.count();
    console.log("Connected DB salon count:", salonCount);
  } catch (error) {
    console.error("DB connection failed:", (error as Error).message);
  }
})();

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});

export default app;
