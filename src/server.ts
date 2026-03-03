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
import { createProxyMiddleware } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);

// Chakra Mirror Proxy: MUST be at the very top
app.use('/chakra-proxy', createProxyMiddleware({
  target: 'https://api.chakrahq.com',
  changeOrigin: true,
  pathRewrite: {
    '^/chakra-proxy': '',
  },
  on: {
    proxyRes: (proxyRes: any) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      proxyRes.headers['access-control-allow-origin'] = '*';
    }
  }
}));

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
  res.removeHeader("X-Frame-Options"); 
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *;"
  );
  next();
});

// Chakra Test Page (Scenario 2 Fix: Hybrid Proxy + Iframe)
app.get('/chakratest', (req: any, res) => {
  const subdomain = req.headers.host?.split('.')[0] || 'unknown';
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Chakra Proxy Bypass Test</title>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f4f9; padding: 20px; }
            #container { padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 500px; width: 100%; }
            .btn { display: block; width: 100%; padding: 14px; margin: 10px 0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; background: #007bff; color: white; }
            #status { margin-top: 1.5rem; padding: 10px; border-radius: 4px; background: #eee; font-size: 0.85rem; }
        </style>
    </head>
    <body>
        <div id="container">
            <h1>Chakra Proxy Bypass</h1>
            <p>Salon: <strong>${subdomain}</strong></p>
            <button id="btn-init">Start WhatsApp Link (Proxy)</button>
            <div id="iframe-target" style="margin-top:20px; min-height:200px; border:1px dashed #ccc;"></div>
            <div id="status">Ready.</div>
        </div>
        <script>
            document.getElementById('btn-init').onclick = async () => {
                const statusEl = document.getElementById('status');
                statusEl.innerText = 'Fetching token...';
                
                try {
                    const res = await fetch('/api/app/chakra/connect-token');
                    const data = await res.json();
                    
                    if (data.connectToken) {
                        statusEl.innerText = 'Token received. Injecting proxied iframe...';
                        
                        // Use OUR proxy path with correct v1 path
                        const proxyUrl = "/chakra-proxy/v1/ext/whatsapp-partner/connect?connectToken=" + encodeURIComponent(data.connectToken);
                        
                        document.getElementById('iframe-target').innerHTML = 
                            '<iframe src="' + proxyUrl + '" style="width:100%; height:300px; border:none;"></iframe>';
                            
                        statusEl.innerText = '✅ Proxied Iframe injected.';
                    } else {
                        throw new Error(data.message || 'Token failed.');
                    }
                } catch (err) {
                    statusEl.innerText = '❌ Error: ' + err.message;
                }
            };
        </script>
    </body>
    </html>
  `);
});

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

app.get(/^(?!\/api|\/auth|\/availability|\/chakratest|\/chakra-proxy).*$/, (req, res) => {
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
