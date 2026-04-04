import { buildBookingUrl } from './bookingUrl.js';

export function buildWaitlistOfferUrl(params: {
  token: string;
  salonId?: number | null;
  salonSlug?: string | null;
}): string {
  const bookingUrl = buildBookingUrl({
    token: params.token,
    salonId: params.salonId,
    salonSlug: params.salonSlug,
  });

  try {
    const url = new URL(bookingUrl);
    if (url.pathname.includes('/m/')) {
      url.pathname = url.pathname.replace(/\/m\/[^/]+$/, '/booking');
    }
    url.searchParams.delete('token');
    url.searchParams.set('waitlistOffer', params.token);
    return url.toString();
  } catch {
    if (bookingUrl.includes('?')) {
      return `${bookingUrl}&waitlistOffer=${encodeURIComponent(params.token)}`;
    }
    return `${bookingUrl}?waitlistOffer=${encodeURIComponent(params.token)}`;
  }
}
