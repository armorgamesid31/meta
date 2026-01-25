import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import salonRoutes from './routes/salon';
import bookingRoutes from './routes/bookings';
import sessionRoutes from './routes/sessions';
import adminRoutes from './routes/admin';

const app = express();

// Configure CORS for frontend access
app.use(cors({
  origin: 'http://localhost:5173', // Allow only your frontend origin
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
app.use('/api/magic-link', sessionRoutes);
app.use('/api/admin', adminRoutes);

// Basic test route
app.get('/', (req, res) => {
  res.send('SalonAsistan Backend is running!');
});

export default app;
