import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import salonRoutes from './routes/salon.js';
import bookingRoutes from './routes/bookings.js';
import sessionRoutes from './routes/sessions.js';
import adminRoutes from './routes/admin.js';
import magicRoutes from './routes/magic.js';
import availabilityRoutes from './routes/availability.js';

const app = express();

// Direct test route - define before middleware
app.get('/test-direct', (req, res) => {
  res.json({ message: 'Direct route working' });
});

// Configure CORS for frontend access
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'], // Allow frontend origins
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware to parse JSON bodies
app.use(express.json());

// API routes
app.use('/auth', authRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/magic-link', magicRoutes);
app.use('/availability', availabilityRoutes);
app.use('/appointments', bookingRoutes);
app.use('/m', magicRoutes);

// Basic test route
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

// Production-ready health check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;
