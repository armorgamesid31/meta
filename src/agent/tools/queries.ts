// W2 — n8n'deki 4 gömülü-SQL tool'unun backend portu (faithful). n8n
// `{{ $fromAI(...) }}` template'leri yerine PARAMETRELİ `$queryRaw` (Prisma
// güvenli kaçışlar; n8n'in .replace(/'/g) hilesi gereksiz). gender/region
// türetme + related_terms regexp_split + match_rank + faq jsonb birebir korundu.

import { prisma } from '../../prisma.js';

/** tool_get_prices portu: hizmet adına/eşanlamlılara göre fiyat (gender/region türetmeli). */
export async function queryServicePrices(
  salonId: number,
  serviceName: string,
  relatedTerms: string,
): Promise<Array<Record<string, unknown>>> {
  const q = (serviceName || '').toLowerCase().trim();
  const rt = (relatedTerms || '').toLowerCase().trim();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH inp AS (SELECT ${q}::text AS q, ${rt}::text AS related_terms),
    terms AS (SELECT trim(value) AS term FROM inp, regexp_split_to_table(inp.related_terms, ',') AS value WHERE trim(value) <> '')
    SELECT s."name", s."price", s."duration", s."category", sr."name" AS "region",
      CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id")
        THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'female'::"CustomerGender") ELSE true END AS "female",
      CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id")
        THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'male'::"CustomerGender") ELSE true END AS "male"
    FROM "Service" s
    LEFT JOIN "ServiceRegion" sr ON sr."id" = s."regionId"
    WHERE s."salonId" = ${salonId} AND COALESCE(s."isActive", true) = true
      AND ((SELECT q FROM inp) = ''
        OR s."name" ILIKE '%' || (SELECT q FROM inp) || '%'
        OR COALESCE(s."category",'') ILIKE '%' || (SELECT q FROM inp) || '%'
        OR EXISTS (SELECT 1 FROM terms t WHERE s."name" ILIKE '%' || t.term || '%' OR COALESCE(s."category",'') ILIKE '%' || t.term || '%'))
    ORDER BY s."price" ASC LIMIT 5`;
  // Decimal price'ı serileştirilebilir Number'a çevir.
  return rows.map((r) => ({ ...r, price: r.price != null ? Number(r.price as any) : null }));
}

/** tool_get_services portu: hizmet arama (match_rank sıralı, gender/region türetmeli). */
export async function searchServices(
  salonId: number,
  q: string,
  relatedTerms: string,
  limit = 10,
): Promise<unknown> {
  const qraw = (q || '').toLowerCase().trim();
  const rt = (relatedTerms || '').toLowerCase().trim();
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const rows = await prisma.$queryRaw<Array<{ services: unknown }>>`
    WITH inp AS (SELECT ${qraw}::text AS q_raw, ${rt}::text AS related_terms_raw),
    norm AS (SELECT CASE WHEN q_raw IN ('hizmet','hizmetler','servis','servisler','işlem','işlemler','uygulama','uygulamalar') THEN '' ELSE q_raw END AS q, related_terms_raw AS related_terms FROM inp),
    terms AS (SELECT trim(value) AS term FROM norm, regexp_split_to_table(norm.related_terms, ',') AS value WHERE trim(value) <> ''),
    rows AS (
      SELECT s."id", s."name", s."category", s."description", s."price", s."duration", sr."name" AS "region",
        COALESCE(s."requiresSpecialist", false) AS "requiresSpecialist",
        CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id") THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'female'::"CustomerGender") ELSE true END AS "female",
        CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id") THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'male'::"CustomerGender") ELSE true END AS "male",
        CASE
          WHEN (SELECT q FROM norm) <> '' AND s."name" ILIKE '%' || (SELECT q FROM norm) || '%' THEN 1
          WHEN (SELECT q FROM norm) <> '' AND COALESCE(s."category",'') ILIKE '%' || (SELECT q FROM norm) || '%' THEN 2
          WHEN (SELECT q FROM norm) <> '' AND COALESCE(s."description",'') ILIKE '%' || (SELECT q FROM norm) || '%' THEN 3
          WHEN EXISTS (SELECT 1 FROM terms t WHERE s."name" ILIKE '%' || t.term || '%' OR COALESCE(s."category",'') ILIKE '%' || t.term || '%' OR COALESCE(s."description",'') ILIKE '%' || t.term || '%') THEN 4
          ELSE 9 END AS match_rank
      FROM "Service" s LEFT JOIN "ServiceRegion" sr ON sr."id" = s."regionId"
      WHERE s."salonId" = ${salonId} AND COALESCE(s."isActive", true) = true
        AND ((SELECT q FROM norm) = ''
          OR s."name" ILIKE '%' || (SELECT q FROM norm) || '%'
          OR COALESCE(s."category",'') ILIKE '%' || (SELECT q FROM norm) || '%'
          OR COALESCE(s."description",'') ILIKE '%' || (SELECT q FROM norm) || '%'
          OR EXISTS (SELECT 1 FROM terms t WHERE s."name" ILIKE '%' || t.term || '%' OR COALESCE(s."category",'') ILIKE '%' || t.term || '%' OR COALESCE(s."description",'') ILIKE '%' || t.term || '%'))
      ORDER BY match_rank, s."category" NULLS LAST, s."name" LIMIT ${lim}
    )
    SELECT COALESCE(jsonb_agg(row_to_json(rows)), '[]'::jsonb) AS services FROM rows`;
  return rows[0]?.services ?? [];
}

/** tool_get_faq portu: salon-geneli + (varsa) kategori SSS'leri (jsonb). */
export async function getSalonFaq(
  salonId: number,
  categoryId?: string,
  categoryName?: string,
): Promise<{ salon_faq: unknown; category_faq: unknown }> {
  const cid = (categoryId || '').trim() || null;
  const cname = (categoryName || '').trim() || null;
  const rows = await prisma.$queryRaw<Array<{ salon_faq: unknown; category_faq: unknown }>>`
    WITH inp AS (SELECT ${cid}::text AS category_id_raw, ${cname}::text AS category_name_raw),
    category_faq AS (
      SELECT sc."commonQuestions" AS faq FROM "ServiceCategory" sc, inp
      WHERE sc."salonId" = ${salonId}
        AND ((inp.category_id_raw IS NOT NULL AND inp.category_id_raw ~ '^[0-9]+$' AND sc."id" = inp.category_id_raw::int)
          OR (inp.category_id_raw IS NULL AND inp.category_name_raw IS NOT NULL AND sc."name" ILIKE '%' || inp.category_name_raw || '%'))
      ORDER BY sc."id" DESC LIMIT 1)
    SELECT COALESCE((SELECT ss."commonQuestions" FROM "SalonSettings" ss WHERE ss."salonId" = ${salonId} LIMIT 1), '[]'::jsonb) AS salon_faq,
      COALESCE((SELECT faq FROM category_faq), '[]'::jsonb) AS category_faq`;
  return rows[0] ?? { salon_faq: [], category_faq: [] };
}
