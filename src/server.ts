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

// Chakra Test Page (BEFORE catch-all routes)
app.get('/chakratest', (req: any, res) => {
  const subdomain = req.headers.host?.split('.')[0] || 'unknown';
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chakra WhatsApp Partner Connect Test</title>
        <script src="https://embed.chakrahq.com/whatsapp-partner-connect/v1/sdk.js"></script>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f9; }
            #container { padding: 2rem; background: white; border-radius: 8px; shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
            h1 { color: #333; margin-bottom: 1.5rem; }
            #status { margin-top: 1rem; color: #666; font-size: 0.9rem; }
            .error { color: #dc3545; }
        </style>
    </head>
    <body>
        <div id="container">
            <h1>WhatsApp Bağlantı Testi</h1>
            <p>Salon: <strong>${subdomain}</strong></p>
            <div id="chakra-button-container">Yükleniyor...</div>
            <div id="status">Token alınıyor...</div>
        </div>

        <script>
            async function initChakra() {
                const statusEl = document.getElementById('status');
                const btnContainer = document.getElementById('chakra-button-container');

                try {
                    const response = await fetch('/api/app/chakra/connect-token');
                    const data = await response.json();

                    if (data.connectToken) {
                        statusEl.innerText = 'Token alındı, SDK başlatılıyor...';
                        
                        // Log global objects for debugging
                        console.log('Global window state:', {
                            Chakra: window.Chakra,
                            ChakraWhatsappConnect: window.ChakraWhatsappConnect
                        });

                        // Check common SDK patterns
                        let ChakraSDK = window.ChakraWhatsappConnect;
                        
                        if (!ChakraSDK && window.Chakra) {
                            ChakraSDK = window.Chakra.WhatsappConnect || window.Chakra.PartnerConnect;
                        }

                        if (!ChakraSDK) {
                            throw new Error('Chakra SDK global nesnesi bulunamadı. Konsolu kontrol edin.');
                        }

                        // Just in case it's not a constructor but a factory function
                        let chakra;
                        if (typeof ChakraSDK === 'function') {
                            try {
                                chakra = new ChakraSDK({
                                    connectToken: data.connectToken,
                                    container: btnContainer,
                                    onSuccess: (data) => {
                                        console.log('Bağlantı Başarılı:', data);
                                        statusEl.innerText = '✅ Bağlantı Başarıyla Tamamlandı!';
                                    },
                                    onError: (err) => {
                                        console.error('Bağlantı Hatası:', err);
                                        statusEl.innerHTML = '<span class="error">❌ Bağlantı Hatası: ' + err.message + '</span>';
                                    }
                                });
                            } catch (e) {
                                // If "new" fails, try calling it as a function
                                chakra = ChakraSDK({
                                    connectToken: data.connectToken,
                                    container: btnContainer,
                                    onSuccess: (data) => {
                                        console.log('Bağlantı Başarılı:', data);
                                        statusEl.innerText = '✅ Bağlantı Başarıyla Tamamlandı!';
                                    },
                                    onError: (err) => {
                                        console.error('Bağlantı Hatası:', err);
                                        statusEl.innerHTML = '<span class="error">❌ Bağlantı Hatası: ' + err.message + '</span>';
                                    }
                                });
                            }
                        } else {
                            throw new Error('Chakra SDK bir fonksiyon/sınıf değil: ' + typeof ChakraSDK);
                        }

                        btnContainer.innerHTML = ''; // Clear loading text
                        if (chakra && typeof chakra.render === 'function') {
                            chakra.render();
                        } else {
                            console.log('SDK initialized but render method missing or already rendered.');
                        }
                    } else {
                        throw new Error(data.message || 'Token alınamadı.');
                    }
                } catch (err) {
                    statusEl.innerHTML = '<span class="error">❌ Hata: ' + err.message + '</span>';
                    btnContainer.innerHTML = '';
                }
            }
                            connectToken: data.connectToken,
                            container: btnContainer,
                            onSuccess: (data) => {
                                console.log('Bağlantı Başarılı:', data);
                                statusEl.innerText = '✅ Bağlantı Başarıyla Tamamlandı!';
                            },
                            onError: (err) => {
                                console.error('Bağlantı Hatası:', err);
                                statusEl.innerHTML = '<span class="error">❌ Bağlantı Hatası: ' + err.message + '</span>';
                            }
                        });

                        btnContainer.innerHTML = ''; // Clear loading text
                        chakra.render();
                    } else {
                        throw new Error(data.message || 'Token alınamadı.');
                    }
                } catch (err) {
                    statusEl.innerHTML = '<span class="error">❌ Hata: ' + err.message + '</span>';
                    btnContainer.innerHTML = '';
                }
            }

            // Start initialization when DOM is ready
            window.addEventListener('DOMContentLoaded', initChakra);
        </script>
    </body>
    </html>
  `);
});

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// catch-all route using regex for compatibility with Express 5 / path-to-regexp v8
app.get(/^(?!\/api|\/auth|\/availability|\/chakratest).*$/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Final Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Final Error Catch:', err);
  res.status(err.status || 500).json({ 
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : undefined
  });
});

const PORT = (Number(process.env.PORT) || 3000);
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
});

export default app;
