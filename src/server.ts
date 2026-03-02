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

// Chakra Test Page (Popup Version - Rev 3)
app.get('/chakratest', (req: any, res) => {
  const subdomain = req.headers.host?.split('.')[0] || 'unknown';
  const timestamp = new Date().getTime();
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chakra Test - Popup Flow</title>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f4f9; padding: 20px; }
            #container { padding: 2.5rem; background: white; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; max-width: 450px; width: 100%; }
            h1 { color: #1a1a1a; margin-bottom: 0.5rem; font-size: 1.6rem; }
            p { color: #666; margin-bottom: 2rem; }
            .btn { display: block; width: 100%; padding: 14px; margin: 12px 0; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; transition: all 0.2s; font-size: 1rem; }
            .btn-fb { background: #1877F2; color: white; display: flex; align-items: center; justify-content: center; gap: 10px; }
            .btn-fb:hover { background: #166fe5; transform: translateY(-1px); }
            #status { margin-top: 1.5rem; padding: 12px; border-radius: 8px; background: #f8f9fa; color: #555; font-size: 0.9rem; border: 1px solid #eee; }
            .error { color: #d63031; background: #fff5f5; border-color: #fab1a0; }
        </style>
    </head>
    <body>
        <div id="container">
            <h1>WhatsApp Entegrasyonu</h1>
            <p>Salon: <strong>${subdomain}</strong></p>
            
            <button id="btn-start" class="btn btn-fb">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Facebook ile Bağlan
            </button>

            <div id="status">Bağlantıyı başlatmak için butona tıklayın.</div>
        </div>

        <script>
            const statusEl = document.getElementById("status");

            document.getElementById("btn-start").onclick = async () => {
                statusEl.innerText = "Bağlantı hazırlanıyor...";
                try {
                    // 1. Backend'den PluginID ve Token al
                    const pluginRes = await fetch("/api/app/chakra/create-plugin", { method: "POST" });
                    const pluginData = await pluginRes.json();
                    
                    if (!pluginData.pluginId) throw new Error("Plugin hazırlanamadı.");

                    const tokenRes = await fetch("/api/app/chakra/connect-token");
                    const tokenData = await tokenRes.json();
                    
                    if (!tokenData.connectToken) throw new Error("Güvenlik token'ı alınamadı.");

                    statusEl.innerText = "Facebook penceresi açılıyor...";

                    // 2. Dinamik Facebook URL Oluştur (Tersine Mühendislik Verileriyle)
                    const fbUrl = "https://www.facebook.com/v24.0/dialog/oauth" +
                        "?app_id=287715906538935" +
                        "&client_id=287715906538935" +
                        "&config_id=721295116725582" +
                        "&display=popup" +
                        "&response_type=code" +
                        "&scope=email,business_management,whatsapp_business_management,whatsapp_business_messaging" +
                        "&extras=" + encodeURIComponent(JSON.stringify({featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3"})) +
                        "&fallback_redirect_uri=" + encodeURIComponent("https://app.chakrahq.com/admin/plugin/" + pluginData.pluginId) +
                        "&redirect_uri=" + encodeURIComponent("https://app.chakrahq.com/v1/ext/whatsapp-partner/connect?connectToken=" + tokenData.connectToken);

                    // 3. Popup Olarak Aç
                    const width = 600, height = 700;
                    const left = (window.innerWidth / 2) - (width / 2);
                    const top = (window.innerHeight / 2) - (height / 2);
                    
                    window.open(fbUrl, "ChakraConnect", "width="+width+",height="+height+",top="+top+",left="+left);
                    
                    statusEl.innerText = "✅ Pencere açıldı. Lütfen işlemleri oradan tamamlayın.";

                } catch (err) { 
                    statusEl.innerHTML = '<span class="error">❌ Hata: ' + err.message + '</span>'; 
                    console.error(err);
                }
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
