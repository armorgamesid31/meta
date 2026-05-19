// Short-link redirect endpoints used by WhatsApp template URL buttons.
//
// Each Meta template URL is `https://api.kedyapp.com/r/<kind>/{{1}}`
// where {{1}} is filled with the salon slug at send time. The salon's
// real destination URL (booking page, Google Maps URL, etc) is resolved
// here from the salon record and a 302 redirect issued.
//
// Routes:
//   /r/booking/:slug → salon's booking / WhatsApp shortlink page
//   /r/maps/:slug    → salon's Google Maps URL (used for Yol Tarifi
//                      and Google Yorum Yap buttons)

import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

const FRONTEND_BASE = (process.env.FRONTEND_URL || 'https://web.kedyapp.com').replace(/\/$/, '');

router.get('/booking/:slug', async (req, res) => {
  const slug = String(req.params?.slug || '').trim().toLowerCase();
  if (!slug) return res.status(404).send('Geçersiz bağlantı.');
  const salon = await prisma.salon.findFirst({
    where: { slug },
    select: { slug: true },
  });
  if (!salon) return res.status(404).send('Salon bulunamadı.');
  // Booking page lives under the salon's public slug on the booking frontend.
  return res.redirect(302, `${FRONTEND_BASE}/${salon.slug}`);
});

router.get('/maps/:slug', async (req, res) => {
  const slug = String(req.params?.slug || '').trim().toLowerCase();
  if (!slug) return res.status(404).send('Geçersiz bağlantı.');
  const salon = await prisma.salon.findFirst({
    where: { slug },
    select: { googleMapsUrl: true, address: true, name: true },
  });
  if (!salon) return res.status(404).send('Salon bulunamadı.');
  // Prefer the explicit Google Maps URL the salon configured; fall back
  // to a Google Maps search for the salon name + address.
  if (salon.googleMapsUrl) {
    return res.redirect(302, salon.googleMapsUrl);
  }
  const query = encodeURIComponent([salon.name, salon.address].filter(Boolean).join(' '));
  return res.redirect(302, `https://www.google.com/maps/search/?api=1&query=${query}`);
});

export default router;
