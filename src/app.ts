import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import salonRoutes from './routes/salon';

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

// Basic test route
app.get('/', (req, res) => {
  res.send('SalonAsistan Backend is running!');
});

export default app;
