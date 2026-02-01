import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
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

// API routes - full registration implementation
console.log('Setting up direct auth routes...');
app.post('/auth/register-salon', async (req, res) => {
  const { email, password, salonName } = req.body;

  if (!email || !password || !salonName) {
    return res.status(400).json({ message: 'Email, password, and salonName are required.' });
  }

  try {
    const existingUser = await prisma.salonUser.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'Bu email adresi ile zaten bir kullanıcı var.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const salon = await prisma.salon.create({
      data: {
        name: salonName,
        users: {
          create: {
            email,
            passwordHash: hashedPassword,
            role: UserRole.OWNER,
          },
        },
      },
      include: {
        users: true,
      },
    });

    const ownerUser = salon.users.find(user => user.role === UserRole.OWNER);

    if (!ownerUser) {
      return res.status(500).json({ message: 'Sahip kullanıcısı oluşturulamadı.' });
    }

    const token = generateToken({
      userId: ownerUser.id,
      salonId: salon.id,
      role: UserRole.OWNER,
    });

    res.status(201).json({ token, user: { id: ownerUser.id, email: ownerUser.email, role: ownerUser.role, salonId: salon.id } });
  } catch (error) {
    console.error('Salon registration error:', error);
    res.status(500).json({ message: 'Sunucu hatası.' });
  }
});
console.log('Direct auth routes set up');
app.use('/auth', authRoutes);
// Core routes for booking functionality
app.use('/api/salon', salonRoutes);
app.use('/api/bookings', bookingRoutes);
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

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});

export default app;
