import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';

export const multiTenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const baseDomain = 'kedyapp.com';

  let slug: string | null = null;

  // 1. Try to extract slug from Origin (most reliable for cross-origin API calls)
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname;

      if (hostname.endsWith(`.${baseDomain}`)) {
        slug = hostname.replace(`.${baseDomain}`, '');
      } else if (hostname === baseDomain) {
        // Base domain, no subdomain
        return next();
      }
    } catch (e) {
      console.error('Error parsing Origin header:', e);
    }
  }

  // 2. Fallback to Host header if Origin is missing or didn't yield a slug
  if (!slug && host) {
    const cleanHost = host.split(':')[0];
    if (cleanHost.endsWith(`.${baseDomain}`)) {
      slug = cleanHost.replace(`.${baseDomain}`, '');
    } else if (cleanHost === baseDomain) {
      return next();
    }
  }

  // 3. Validate extracted slug
  const restrictedSlugs = ['api', 'www', 'admin', 'portal'];
  if (!slug || restrictedSlugs.includes(slug.toLowerCase())) {
    // If it's a specific route like /health or /auth, we might want to allow it
    // But for general multi-tenant isolation, we require a valid tenant slug
    if (req.path === '/health' || req.path.startsWith('/auth/')) {
        return next();
    }
    return res.status(400).json({ message: 'Tenant context required' });
  }

  // 4. Find Salon by slug
  try {
    const salon = await prisma.salon.findUnique({
      where: { slug: slug.toLowerCase() },
    });

    if (!salon) {
      return res.status(404).json({ message: `Salon with slug '${slug}' not found` });
    }

    // Attach salon to request object
    (req as any).salon = salon;
    next();
  } catch (error) {
    console.error('Error in multiTenantMiddleware:', error);
    return res.status(500).json({ message: 'Internal server error during tenant lookup' });
  }
};
