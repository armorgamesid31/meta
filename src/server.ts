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

// Chakra Test Page
app.get('/chakratest', (req: any, res) => {
  const subdomain = req.headers.host?.split('.')[0] || 'unknown';
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chakra Test</title>
        <script src="https://embed.chakrahq.com/whatsapp-partner-connect/v1/sdk.js"></script>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f4f9; padding: 20px; }
            #container { padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 450px; width: 100%; }
            h1 { color: #333; margin-bottom: 1.5rem; font-size: 1.5rem; }
            .btn { display: block; width: 100%; padding: 12px; margin: 10px 0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
            .btn-primary { background: #007bff; color: white; }
            .btn-success { background: #28a745; color: white; }
            #status { margin-top: 1.5rem; padding: 10px; border-radius: 4px; background: #eee; color: #555; font-size: 0.85rem; word-break: break-all; min-height: 40px; }
            .error { color: #dc3545; background: #fceea7; }
        </style>
    </head>
    <body>
        <div id="container">
            <h1>Chakra WhatsApp Test</h1>
            <p>Salon: <strong>${subdomain}</strong></p>
            <button id="btn-create" class="btn btn-primary">1. Yeni Plugin Oluştur</button>
            <button id="btn-connect" class="btn btn-success">2. WhatsApp Bağla (SDK)</button>
            <div id="chakra-button-container"></div>
            <div id="status">Lütfen bir işlem seçin.</div>
        </div>
        <script>
            const statusEl = document.getElementById('status');
            const btnContainer = document.getElementById('chakra-button-container');

            document.getElementById('btn-create').onclick = async () => {
                statusEl.innerText = 'Plugin oluşturuluyor...';
                try {
                    const res = await fetch('/api/app/chakra/create-plugin', { method: 'POST' });
                    const data = await res.json();
                    statusEl.innerText = data.success ? '✅ Plugin OK: ' + data.pluginId : '❌ Hata: ' + (data.message || 'Bilinmiyor');
                } catch (err) { statusEl.innerText = '❌ Hata: ' + err.message; }
            };

            document.getElementById('btn-connect').onclick = async () => {
                statusEl.innerText = 'Token alınıyor...';
                btnContainer.innerHTML = ''; 

                try {
                    const response = await fetch('/api/app/chakra/connect-token');
                    const data = await response.json();
                    if (!data.connectToken) throw new Error(data.message || 'Önce plugin oluşturun.');
                    
                    if (typeof window.ChakraWhatsappConnect === 'undefined') {
                        throw new Error('SDK (ChakraWhatsappConnect) yüklenemedi.');
                    }

                    statusEl.innerText = 'SDK başlatılıyor...';
                    
                    const chakra = window.ChakraWhatsappConnect.init({
                        connectToken: data.connectToken,
                        container: '#chakra-button-container',
                        baseUrl: 'https://api.chakrahq.com',
                        onMessage: (event, payload) => {
                            console.log('Chakra Event:', event, payload);
                            statusEl.innerText = 'Event: ' + event;
                            if (event === 'CHAKRA_CONNECT_SUCCESS') statusEl.innerText = '✅ Bağlantı Başarılı!';
                        },
                        onReady: () => {
                            console.log('Chakra SDK Ready');
                            statusEl.innerText = '✅ SDK Hazır. Buton aşağıda belirmeli.';
                        },
                        onError: (err) => {
                            console.error('Chakra Error:', err);
                            statusEl.innerText = '❌ SDK Hatası: ' + (err.message || 'Bilinmiyor');
                        }
                    });
                    
                } catch (err) { statusEl.innerText = '❌ Hata: ' + err.message; }
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
