import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';

export const multiTenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const tenantHeader = req.headers['x-tenant-slug'];
  const baseDomain = 'kedyapp.com';
  const isAuthenticated = Boolean(req.headers.authorization);

  // Slug candidates from each source, all normalised. We prefer the source
  // that is hardest for a client to forge:
  //   1. Host header subdomain  (set by the browser/proxy, hard to spoof
  //      cross-tenant without DNS access)
  //   2. Origin header subdomain (set by the browser for CORS)
  //   3. x-tenant-slug header   (trivially settable by any client; treat as
  //      hint only on unauthenticated requests)
  const headerSlug =
    typeof tenantHeader === 'string' && tenantHeader.trim()
      ? tenantHeader.trim().toLowerCase()
      : null;

  let originSlug: string | null = null;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname.toLowerCase();
      if (hostname.endsWith(`.${baseDomain}`)) {
        originSlug = hostname.replace(`.${baseDomain}`, '');
      }
    } catch (e) {
      // Ignore invalid origin format
    }
  }

  let hostSlug: string | null = null;
  if (host) {
    const cleanHost = host.split(':')[0].toLowerCase();
    if (cleanHost.endsWith(`.${baseDomain}`)) {
      hostSlug = cleanHost.replace(`.${baseDomain}`, '');
    }
  }

  let slug: string | null = null;

  if (isAuthenticated) {
    // Authenticated callers (mobile/admin app) may legitimately set
    // x-tenant-slug for server-to-server / multi-salon switching. Auth
    // layer already constrains what membership the token can act on, so
    // header is acceptable here.
    slug = headerSlug || originSlug || hostSlug;
  } else {
    // Unauthenticated traffic (booking page, OTP register, public APIs).
    // A forged x-tenant-slug here lets an attacker spam OTPs and create
    // customers against any tenant. Lock the slug to what the Host /
    // Origin says.
    const derivedSlug = hostSlug || originSlug;
    if (headerSlug && derivedSlug && headerSlug !== derivedSlug) {
      // Mismatch → ignore the header. Do not 400 because legitimate
      // clients (e.g. apex domain) may send a header without a matching
      // subdomain; falling back to derivedSlug keeps them working while
      // closing the cross-tenant escalation.
      slug = derivedSlug;
    } else {
      slug = derivedSlug || headerSlug;
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
