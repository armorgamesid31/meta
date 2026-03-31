function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function normalizeSlug(value: unknown, fallback?: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback || '';
}

export function buildBookingUrl(params: {
  token: string;
  salonId?: number | null;
  salonSlug?: string | null;
}): string {
  const defaultTemplate = params.salonSlug
    ? `https://{slug}.kedyapp.com/randevu?{token}`
    : null;

  const base =
    (process.env.BOOKING_URL_TEMPLATE ||
      process.env.BOOKING_BASE_URL ||
      defaultTemplate ||
      process.env.FRONTEND_URL ||
      'http://localhost:5173')?.trim() || 'http://localhost:5173';

  const salonId = Number.isFinite(params.salonId || 0) ? String(params.salonId) : '';
  const slug = normalizeSlug(params.salonSlug, salonId);

  let template = base;
  const hasToken = template.includes('{token}');

  template = template
    .replace(/\{token\}/g, params.token)
    .replace(/\{salonId\}/g, salonId)
    .replace(/\{slug\}/g, slug);

  const normalized = normalizeBaseUrl(template);

  if (hasToken) {
    return normalized;
  }

  return `${normalized}/m/${params.token}`;
}
