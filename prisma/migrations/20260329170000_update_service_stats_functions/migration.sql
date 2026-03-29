CREATE OR REPLACE FUNCTION recalc_service_stats(p_service_id int)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_salon_id int;
  v_description text;
  v_region_id int;
  v_region_name text;
  v_price float;
  v_duration int;
BEGIN
  SELECT s."salonId", s."description", s."regionId", sr."name", s."price", s."duration"
  INTO v_salon_id, v_description, v_region_id, v_region_name, v_price, v_duration
  FROM "Service" s
  LEFT JOIN "ServiceRegion" sr ON sr."id" = s."regionId"
  WHERE s."id" = p_service_id;

  IF v_salon_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM "ServiceStats"
  WHERE "serviceId" = p_service_id AND "salonId" = v_salon_id;

  IF EXISTS (SELECT 1 FROM "StaffService" ss WHERE ss."serviceId" = p_service_id) THEN
    INSERT INTO "ServiceStats"(
      "serviceId",
      "salonId",
      "gender",
      "minPrice",
      "maxPrice",
      "minDuration",
      "maxDuration",
      "description",
      "regionId",
      "regionName",
      "calculatedAt"
    )
    SELECT
      p_service_id,
      v_salon_id,
      ss."gender",
      MIN(ss."price"),
      MAX(ss."price"),
      MIN(ss."duration"),
      MAX(ss."duration"),
      v_description,
      v_region_id,
      v_region_name,
      NOW()
    FROM "StaffService" ss
    WHERE ss."serviceId" = p_service_id
    GROUP BY ss."gender";
  ELSE
    INSERT INTO "ServiceStats"(
      "serviceId",
      "salonId",
      "gender",
      "minPrice",
      "maxPrice",
      "minDuration",
      "maxDuration",
      "description",
      "regionId",
      "regionName",
      "calculatedAt"
    )
    VALUES (
      p_service_id,
      v_salon_id,
      'female',
      v_price,
      v_price,
      v_duration,
      v_duration,
      v_description,
      v_region_id,
      v_region_name,
      NOW()
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_recalc_service_stats()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_service_id int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_service_id := OLD."serviceId";
  ELSE
    v_service_id := NEW."serviceId";
  END IF;

  PERFORM recalc_service_stats(v_service_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
