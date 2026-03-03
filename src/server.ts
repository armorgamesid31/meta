import dotenv from 'dotenv';
dotenv.config();
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
app.get("/debug/db-check", async (req, res) => {
  try {
    const salons = await prisma.salon.findMany({ select: { id: true, slug: true } });
    res.json({ count: salons.length, salons });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Chakra Pass-through Webhook (DEBUG ONLY - NO BUSINESS LOGIC)
app.post("/api/internal/chakra/webhook", (req, res) => {
  console.log("--- CHAKRA WEBHOOK RECEIVED ---");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  // Always return 200 OK to prevent webhook retry loops during debugging
  res.status(200).send("OK");
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

// Chakra Test Page (Official SDK Replication)
app.get('/chakratest', (req: any, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Chakra SDK Official Test</title>
        <script src="https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js"></script>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f4f9; padding: 20px; }
            #container { padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 500px; width: 100%; }
            .btn { display: block; width: 100%; padding: 14px; margin: 10px 0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; background: #007bff; color: white; }
            #status { margin-top: 1.5rem; padding: 10px; border-radius: 4px; background: #eee; font-size: 0.85rem; }
        </style>
    </head>
    <body>
        <div id="container">
            <h1>Chakra SDK Official Test</h1>
            <button id="btn-init">Get Token & Init SDK</button>
            <div id="sdk-container" style="margin-top:20px; border:1px dashed #ccc; min-height:100px; padding:10px;">
                SDK will load here...
            </div>
            <div id="status">Ready.</div>
        </div>
        <script>
            document.getElementById("btn-init").onclick = async () => {
                const statusEl = document.getElementById("status");
                const sdkContainer = document.getElementById("sdk-container");

                statusEl.innerText = "Fetching token...";
                try {
                    const res = await fetch("/api/app/chakra/connect-token");
                    const data = await res.json();
                    
                    if (!data.connectToken) throw new Error(data.message || "Token failed.");

                    statusEl.innerText = "Token received. Initializing SDK...";
                    
                    // Official SDK initialization
                    const chakraWhatsappConnect = window.ChakraWhatsappConnect.init({
                        connectToken: data.connectToken,
                        container: sdkContainer,
                        // No baseUrl needed as per latest docs
                        onMessage: (event, payload) => {
                            console.log("Chakra Event:", event, payload);
                            statusEl.innerText = "Event: " + event;
                        },
                        onReady: () => {
                            console.log("Chakra SDK Ready");
                            statusEl.innerText = "✅ SDK Initialized. Button should be visible.";
                        },
                        onError: (err) => {
                            console.error("Chakra Error:", err);
                            statusEl.innerText = "❌ SDK Error: " + (err.message || "Unknown");
                        }
                    });

                    // You can optionally store chakraWhatsappConnect to call its destroy method later
                    // window.chakraInstance = chakraWhatsappConnect;

                } catch (err) {
                    statusEl.innerText = "❌ Error: " + err.message;
                    console.error(err);
                }
            };
        </script>
    </body>
    </html>
  `);
});

const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

app.get(/^(?!\/api|\/auth|\/availability|\/chakratest).*$/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Final Error Catch:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error"
  });
});

const PORT = (Number(process.env.PORT) || 3000);
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});
export default app;
