import axios from 'axios';
import { BusinessError } from '../lib/errors.js';

export type ResolveMapsLinkResult = {
  resolvedUrl: string;
  address: string | null;
  city: string | null;
  district: string | null;
  googleMapsUrl: string;
  place_id?: string | null;
};

const extractAddressFromMapsUrl = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url);
    const q = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || '';
    const place = parsedUrl.searchParams.get('place') || '';
    const raw = decodeURIComponent((q || place).replace(/\+/g, ' ')).trim();
    if (!raw) {
      return null;
    }
    return raw.replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
};

const extractPlaceLabelFromMapsUrl = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    const placeIndex = pathParts.findIndex((part) => part.toLowerCase() === 'place');
    if (placeIndex >= 0 && pathParts[placeIndex + 1]) {
      return decodeURIComponent(pathParts[placeIndex + 1]).replace(/\+/g, ' ').trim();
    }
    return null;
  } catch {
    return null;
  }
};

const parseGoogleAddressComponents = (components: any[] | undefined) => {
  const findLong = (type: string) =>
    components?.find((item) => Array.isArray(item?.types) && item.types.includes(type))?.long_name || '';

  const city =
    findLong('locality') ||
    findLong('administrative_area_level_1') ||
    findLong('administrative_area_level_2');
  const district =
    findLong('administrative_area_level_2') ||
    findLong('administrative_area_level_3') ||
    findLong('sublocality_level_1') ||
    findLong('sublocality');

  return {
    city: city.trim() || null,
    district: district.trim() || null,
  };
};

const extractPlaceId = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.searchParams.get('place_id') ||
      parsedUrl.searchParams.get('query_place_id') ||
      null
    );
  } catch {
    return null;
  }
};

const extractLatLng = (url: string): string | null => {
  const dMatch = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dMatch?.[1] && dMatch?.[2]) {
    return `${dMatch[1]},${dMatch[2]}`;
  }

  const atMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch?.[1] && atMatch?.[2]) {
    return `${atMatch[1]},${atMatch[2]}`;
  }

  return null;
};

/**
 * Validates that the provided string is a Google Maps URL with HTTPS protocol.
 * Throws BusinessError(400) on failure.
 */
export function validateMapsLinkInput(inputUrl: string): URL {
  if (!inputUrl) {
    throw new BusinessError('VALIDATION_FAILED', 'URL gerekli.', 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz URL.', 400);
  }

  if (parsed.protocol !== 'https:') {
    throw new BusinessError('VALIDATION_FAILED', 'Sadece https linkleri desteklenir.', 400);
  }

  const host = parsed.hostname.toLowerCase();
  const allowedHosts = ['maps.app.goo.gl', 'share.google', 'goo.gl'];
  const isGoogleMapsHost = host.includes('google.') || allowedHosts.some((entry) => host === entry);
  if (!isGoogleMapsHost) {
    throw new BusinessError('VALIDATION_FAILED', 'Sadece Google Maps linkleri desteklenir.', 400);
  }

  return parsed;
}

/**
 * Resolves a (possibly shortened) Google Maps link into an address + city/district
 * tuple, using Google Geocode API when GOOGLE_MAPS_API_KEY is configured.
 *
 * Throws BusinessError(400) for validation failures and BusinessError(502) when
 * the link cannot be resolved.
 */
export async function resolveMapsLink(inputUrl: string): Promise<ResolveMapsLinkResult> {
  validateMapsLinkInput(inputUrl);

  try {
    const response = await axios.get(inputUrl, {
      maxRedirects: 6,
      timeout: 8000,
      responseType: 'text',
      validateStatus: () => true,
    });

    const finalUrl: string =
      (response as any)?.request?.res?.responseUrl ||
      (response.headers?.location ? new URL(response.headers.location, inputUrl).toString() : inputUrl);

    let address: string | null = extractAddressFromMapsUrl(finalUrl);
    let city: string | null = null;
    let district: string | null = null;
    let placeId: string | null = extractPlaceId(finalUrl);

    const mapsApiKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (mapsApiKey) {
      const latlng = extractLatLng(finalUrl);
      const placeLabel = extractPlaceLabelFromMapsUrl(finalUrl) || extractPlaceLabelFromMapsUrl(inputUrl) || '';
      const addressQuery = address || extractAddressFromMapsUrl(inputUrl) || placeLabel;

      const baseParams: Record<string, string> = {
        language: 'tr',
        region: 'tr',
        key: mapsApiKey,
      };

      const geocodeWith = async (params: Record<string, string>) => {
        const geocodeResponse = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          timeout: 8000,
          params,
          validateStatus: () => true,
        });
        return Array.isArray(geocodeResponse.data?.results) ? geocodeResponse.data.results[0] : null;
      };

      // Priority: place_id -> address text/place label -> latlng fallback.
      let result: any = null;
      if (placeId) {
        result = await geocodeWith({ ...baseParams, place_id: placeId });
      }
      if (!result && addressQuery) {
        result = await geocodeWith({ ...baseParams, address: addressQuery });
      }
      if (!result && latlng) {
        result = await geocodeWith({ ...baseParams, latlng });
      }

      if (result) {
        const parsedComponents = parseGoogleAddressComponents(result.address_components);
        city = parsedComponents.city;
        district = parsedComponents.district;
        address = (result.formatted_address || address || '').trim() || address;
        if (!placeId && typeof result.place_id === 'string' && result.place_id) {
          placeId = result.place_id;
        }
      }
    }

    return {
      resolvedUrl: finalUrl,
      address,
      city,
      district,
      googleMapsUrl: finalUrl,
      place_id: placeId,
    };
  } catch (error) {
    if (error instanceof BusinessError) {
      throw error;
    }
    console.error('Resolve maps link error:', error);
    throw new BusinessError('BAD_GATEWAY', 'Link çözümlenemedi.', 502);
  }
}
