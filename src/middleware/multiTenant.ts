import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';

export const multiTenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const host = req.headers.host;

  if (!host) {
    return next();
  }

  // Define the base domain
  const baseDomain = 'kedyapp.com';
  
  // Clean the host (remove port if exists)
  const cleanHost = host.split(':')[0];

  // If host is exactly the base domain, skip lookup
  if (cleanHost === baseDomain) {
    return next();
  }

  // Check if it ends with the base domain and has a subdomain
  if (cleanHost.endsWith(`.${baseDomain}`)) {
    const subdomain = cleanHost.replace(`.${baseDomain}`, '');

    if (subdomain && subdomain !== 'www') {
      try {
        const salon = await prisma.salon.findUnique({
          where: { slug: subdomain },
        });

        if (!salon) {
          return res.status(404).json({ message: `Salon with slug '${subdomain}' not found` });
        }

        // Attach salon to request object
        (req as any).salon = salon;
      } catch (error) {
        console.error('Error in multiTenantMiddleware:', error);
        return res.status(500).json({ message: 'Internal server error during tenant lookup' });
      }
    }
  }

  next();
};
