import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';

export const multiTenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const baseDomain = 'kedyapp.com';

  let slug: string | null = null;

  // 1. Try to extract slug from Origin
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname;

      if (hostname.endsWith(`.${baseDomain}`)) {
        slug = hostname.replace(`.${baseDomain}`, '');
      }
    } catch (e) {
      // Ignore invalid origin format
    }
  }

  // 2. Fallback to Host header
  if (!slug && host) {
    const cleanHost = host.split(':')[0];
    if (cleanHost.endsWith(`.${baseDomain}`)) {
      slug = cleanHost.replace(`.${baseDomain}`, '');
    }
  }

  // 3. Skip tenant requirement for non-tenant subdomains
  const restrictedSlugs = ['api', 'www', 'admin', 'portal', ''];
  if (!slug || restrictedSlugs.includes(slug.toLowerCase())) {
    return next();
  }

  // 4. Find Salon by slug
  try {
    const salon = await prisma.salon.findUnique({
      where: { slug: slug.toLowerCase() },
    });

    if (!salon) {
      // Instead of JSON 404 here, we just don't attach the salon
      // The routes that require a salon will check for req.salon and handle it
      return next();
    }

    // Attach salon to request object
    (req as any).salon = salon;
    next();
  } catch (error) {
    console.error('Error in multiTenantMiddleware:', error);
    next(); // Continue even on error, let the route decide if req.salon is needed
  }
};
