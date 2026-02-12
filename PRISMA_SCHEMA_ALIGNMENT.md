# Prisma Schema Alignment – Breaking Changes

## Summary

Prisma schema has been aligned with the current database state via `prisma db pull`. The following tables are now correctly mapped:

- **Service** – has category (String?), requiresSpecialist; price/duration remain fallback values
- **Staff** – has staffServices (StaffService[]), StaffWorkingHours
- **StaffService** – authoritative for price and duration; links Staff and Service
- **ServiceStats** – serviceId as PRIMARY KEY; 1:1 with Service
- **StaffWorkingHours** – staff working hours per dayOfWeek
- **Appointment** – unchanged

**Removed:** `_StaffServices` (many-to-many) – no longer used.

---

## Breaking Changes in Backend Logic

### 1. Service – No `isSynergyEnabled` or `category` relation

**Before:** Service had `isSynergyEnabled: Boolean` and `category: ServiceCategory` relation.

**After:** Service has `category: String?` and `requiresSpecialist: Boolean`. No `isSynergyEnabled`, no `ServiceCategory` relation.

**Affected code:**
- `src/routes/bookings.ts` (magic link appointment flow) – uses `service.isSynergyEnabled`, `service.category?.schedulingRule`, `service.category?.synergyFactor`, `service.category?.bufferMinutes`
- `src/utils/durationCalculator.ts` – expects `ServiceWithCategory` with `isSynergyEnabled` and `category: { schedulingRule, synergyFactor, bufferMinutes }`

**Impact:** Synergy calculation will not work as before. `isSynergyEnabled` will be `undefined` (falsy), so services are treated as standard. `category` will be a string or null, so no scheduling rules or synergy factors.

---

### 2. Staff–Service: No direct many-to-many

**Before:** `Staff.services` and `Service.staff` via `_StaffServices`.

**After:** Relation is through `StaffService`. Use `Staff.staffServices` and `Service.staffServices`, then resolve Staff/Service from there.

**Affected code:**
- Any code using `staff.services` or `service.staff`
- Availability logic previously using staff–service links must use `StaffService` for service capability

---

### 3. Customer.phone uniqueness

**Before:** `@@unique([phone, salonId])` – one customer per phone per salon.

**After:** `phone` is globally `@unique` – one customer per phone across the system.

**Affected code:**
- `src/routes/customers.ts` – `findFirst({ where: { phone, salonId }})` still works; with global uniqueness there is at most one row, but salonId check may not match if phone is shared across salons.
- `src/routes/bookingContext.ts` – same pattern.
- `src/routes/bookings.ts` (magic link) – same pattern.

**Impact:** Same phone cannot be used for multiple salons. Register/booking flows may behave differently if the DB was intended to allow one phone per salon.

---

### 4. Duration and price source

**Before:** `Service.duration` and `Service.price` were the main source.

**After:** `StaffService` is authoritative for price and duration. `Service.price` and `Service.duration` are fallbacks.

**Required change:** When booking a specific staff+service, use `StaffService.price` and `StaffService.duration` instead of `Service.price` and `Service.duration`.

---

### 5. Availability logic

**Required:** Availability should use:
- `StaffService` for which staff offer which services
- `StaffWorkingHours` for staff availability
- Existing `Appointment` constraints

Current availability engine still uses its own constraints (e.g. hardcoded staff IDs) and does not yet use `StaffService` or `StaffWorkingHours`.

---

## Schema Validation Note

`StaffWorkingHours` has a check constraint (`StaffWorkingHours_dayOfWeek_check`) that Prisma does not fully support. It is reflected in the schema but may need extra handling in migrations.
