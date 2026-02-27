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
import chakraRoutes from './routes/chakra.js';
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
app.use('/api/app/chakra', chakraRoutes);
app.use('/availability', availabilityRoutes);
app.use('/appointments', bookingRoutes);

// Proper header for iframe/CORS support
app.use((req, res, next) => {
  // We must allow framing and bypass strict CSP for testing.
  res.removeHeader("X-Frame-Options"); 
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *;"
  );
  next();
});

// Proxy /connect route to Chakra API to handle SDK's internal calls
app.get('/connect', (req, res) => {
  const token = req.query.connectToken;
  if (!token) {
    return res.status(400).json({ message: 'Missing connectToken for proxy.' });
  }
  // Redirect to Chakra's actual connect endpoint
  res.redirect(`https://api.chakrahq.com/v1/ext/whatsapp-partner/connect?connectToken=${token}`);
});

// Chakra Test Page
app.get('/chakratest', (req: any, res) => {
  const subdomain = req.headers.host?.split('.')[0] || 'unknown';
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chakra Test - Direct Link</title>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f4f9; padding: 20px; }
            #container { padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 450px; width: 100%; }
            h1 { color: #333; margin-bottom: 1.5rem; font-size: 1.5rem; }
            .btn { display: block; width: 100%; padding: 12px; margin: 10px 0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background 0.2s; text-decoration: none; text-align: center; }
            .btn-primary { background: #007bff; color: white; }
            .btn-success { background: #28a745; color: white; }
            .btn-warning { background: #ffc107; color: #212529; }
            #status { margin-top: 1.5rem; padding: 10px; border-radius: 4px; background: #eee; color: #555; font-size: 0.85rem; word-break: break-all; min-height: 40px; }
            .error { color: #dc3545; background: #fceea7; }
        </style>
    </head>
    <body>
        <div id="container">
            <h1>Chakra Test (Direct Link)</h1>
            <p>Salon: <strong>${subdomain}</strong></p>
            <button id="btn-create" class="btn btn-primary">1. Yeni Plugin Oluştur</button>
            <a id="lnk-connect" href="#" target="_blank" class="btn btn-success" style="display:none;">2. WhatsApp Bağla (Yeni Sekmede Aç)</a>
            <div id="status">Lütfen önce plugin oluşturun veya mevcutsa 1. adıma basın.</div>
        </div>
        <script>
            const statusEl = document.getElementById("status");
            const lnkConnect = document.getElementById("lnk-connect");

            document.getElementById("btn-create").onclick = async () => {
                statusEl.innerText = "Plugin hazırlanıyor...";
                try {
                    const res = await fetch("/api/app/chakra/create-plugin", { method: "POST" });
                    const data = await res.json();
                    
                    if (data.success || data.pluginId) {
                        const tokenRes = await fetch("/api/app/chakra/connect-token");
                        const tokenData = await tokenRes.json();
                        
                        if (tokenData.connectToken) {
                            const url = "https://api.chakrahq.com/v1/ext/whatsapp-partner/connect?connectToken=" + encodeURIComponent(tokenData.connectToken);
                            lnkConnect.href = url;
                            lnkConnect.style.display = "block";
                            statusEl.innerText = "✅ Hazır! Lütfen aşağıdaki butona tıklayarak yeni sekmede devam edin.";
                        } else {
                            throw new Error("Token alınamadı.");
                        }
                    } else {
                        throw new Error(data.message || "Plugin oluşturulamadı.");
                    }
                } catch (err) { statusEl.innerHTML = '<span class="error">❌ Hata: ' + err.message + '</span>'; }
            };
        </script>
    </body>
    </html>
  `);
});

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

app.get(/^(?!\/api|\/auth|\/availability|\/chakratest).*$/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Final Error Catch:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error'
  });
});

const PORT = (Number(process.env.PORT) || 3000);
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});
export default app;
