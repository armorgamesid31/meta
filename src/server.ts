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
console.log('Auth routes:', typeof authRoutes);
app.use('/auth', authRoutes);

// Direct register-salon route for testing
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
            role: 'OWNER',
          },
        },
      },
      include: {
        users: true,
      },
    });

    const ownerUser = salon.users.find(user => user.role === 'OWNER');

    if (!ownerUser) {
      return res.status(500).json({ message: 'Sahip kullanıcısı oluşturulamadı.' });
    }

    const token = generateToken({
      userId: ownerUser.id,
      salonId: salon.id,
      role: 'OWNER',
    });

    res.status(201).json({ token, user: { id: ownerUser.id, email: ownerUser.email, role: ownerUser.role, salonId: salon.id } });
  } catch (error) {
    console.error('Salon registration error:', error);
    res.status(500).json({ message: 'Sunucu hatası.' });
  }
});
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
