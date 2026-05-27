import { prisma } from '../prisma.js';

export const ACCESS_VERSION = 1;

export const FIXED_ROLES = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF', 'FINANCE'] as const;
export type FixedRole = (typeof FIXED_ROLES)[number];

export type PermissionSeed = {
  key: string;
  module: string;
  description: string;
  isCritical?: boolean;
};

export const PERMISSION_CATALOG: PermissionSeed[] = [
  { key: 'dashboard.view', module: 'dashboard', description: 'Isletme panelini goruntule' },
  { key: 'appointments.view', module: 'appointments', description: 'Randevulari goruntule' },
  { key: 'appointments.manage', module: 'appointments', description: 'Randevu olustur ve guncelle' },
  { key: 'appointments.payment.update', module: 'appointments', description: 'Odeme yontemini guncelle', isCritical: true },
  { key: 'customers.view', module: 'customers', description: 'Musterileri goruntule' },
  { key: 'customers.manage', module: 'customers', description: 'Musteri olustur ve guncelle' },
  { key: 'services.manage', module: 'services', description: 'Hizmet ve kategori yonetimi' },
  { key: 'staff.manage', module: 'staff', description: 'Uzman kayitlarini yonet' },
  { key: 'packages.manage', module: 'packages', description: 'Paket sablonlari ve bakiyeleri yonet' },
  { key: 'analytics.view', module: 'analytics', description: 'Analitik goruntule' },
  { key: 'inventory.manage', module: 'inventory', description: 'Envanteri yonet' },
  { key: 'campaigns.manage', module: 'campaigns', description: 'Kampanyalari yonet' },
  { key: 'campaigns.view', module: 'campaigns', description: 'Kampanyalari goruntule' },
  { key: 'campaigns.publish', module: 'campaigns', description: 'Kampanya yayimla ve gonder', isCritical: true },
  { key: 'automations.manage', module: 'automations', description: 'Otomasyonlari yonet' },
  { key: 'blacklist.manage', module: 'blacklist', description: 'Kara liste kayitlarini yonet' },
  { key: 'conversations.manage', module: 'conversations', description: 'Konusma ve yanitlari yonet' },
  { key: 'instagram_inbox.manage', module: 'conversations', description: 'Instagram gelen kutusunu yonet' },
  { key: 'notifications.inbox.view', module: 'notifications', description: 'Kendi bildirimlerini goruntule' },
  { key: 'notifications.preferences.manage', module: 'notifications', description: 'Kendi bildirim tercihlerini yonet' },
  { key: 'notifications.policy.manage', module: 'notifications', description: 'Bildirim rol matrisini yonet', isCritical: true },
  { key: 'website.manage', module: 'website', description: 'Web sitesi icerigini yonet' },
  { key: 'meta_direct.manage', module: 'integrations', description: 'Meta Direct entegrasyonunu yonet' },
  { key: 'imports.manage', module: 'imports', description: 'Veri aktarim sihirbazi ve aktarim islemlerini yonet' },
  { key: 'timeoff.manage', module: 'staff', description: 'Tatil ve izin planlamasini yonet' },
  { key: 'salon.faq.manage', module: 'website', description: 'Salon SSS icerigini yonet' },
  { key: 'referrals.view', module: 'settings', description: 'Referans programini goruntule' },
  { key: 'access.roles.manage', module: 'access', description: 'Rol yetki matrisini yonet', isCritical: true },
  { key: 'access.users.manage', module: 'access', description: 'Ekip kullanicilari ve rolleri yonet', isCritical: true },
  { key: 'access.permission_overrides.edit', module: 'access', description: 'Kullanici yetki istisnalarini duzenle', isCritical: true },
  { key: 'access.audit.view', module: 'access', description: 'Erisim denetim kayitlarini goruntule' },
] as const;

const DEFAULT_ROLE_PERMISSIONS: Record<FixedRole, string[]> = {
  OWNER: PERMISSION_CATALOG.map((item) => item.key),
  MANAGER: PERMISSION_CATALOG.map((item) => item.key),
  RECEPTION: [
    'appointments.view',
    'appointments.manage',
    'customers.view',
    'customers.manage',
    'campaigns.view',
    'packages.manage',
    'blacklist.manage',
    'conversations.manage',
    'instagram_inbox.manage',
    'imports.manage',
    'timeoff.manage',
    'salon.faq.manage',
    'referrals.view',
    'notifications.inbox.view',
    'notifications.preferences.manage',
  ],
  STAFF: [
    'appointments.view',
    'appointments.manage',
    'customers.view',
    'customers.manage',
    'campaigns.view',
    'blacklist.manage',
    'conversations.manage',
    'notifications.inbox.view',
    'notifications.preferences.manage',
  ],
  FINANCE: [
    'analytics.view',
    'inventory.manage',
    'campaigns.manage',
    'campaigns.view',
    'notifications.inbox.view',
    'notifications.preferences.manage',
  ],
};

export function normalizeRole(rawRole: unknown): FixedRole {
  const role = String(rawRole || '').toUpperCase().trim();
  if (FIXED_ROLES.includes(role as FixedRole)) return role as FixedRole;
  return 'STAFF';
}

export function normalizeRoles(rawRoles: unknown): FixedRole[] {
  if (!Array.isArray(rawRoles)) {
    return [];
  }
  const normalized = rawRoles.map((role) => normalizeRole(role));
  return Array.from(new Set(normalized));
}

// Process-lifetime guard for the permission catalog upsert loop.
//
// Before this guard the function ran on EVERY bootstrap call — meaning
// every single mobile login (and every getEffectivePermissionSet
// call from notification policy reads, etc.) re-upserted all 31 rows.
// pg_stat_statements told the truth: 2.3M+ INSERT-on-conflict hits
// totalling ~47 minutes of cumulative Postgres time. The PERMISSION_CATALOG
// is a compile-time constant; the rows it writes literally cannot change
// without a redeploy, and a redeploy resets the in-memory flag anyway.
//
// We do still upsert on the first call after each process start — that
// covers fresh DB schemas, catalog additions in new releases, and any
// drift between code and DB without forcing a manual migration.
let permissionCatalogEnsuredAt: number | null = null;
const PERMISSION_CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function ensurePermissionCatalog(): Promise<void> {
  if (
    permissionCatalogEnsuredAt !== null &&
    Date.now() - permissionCatalogEnsuredAt < PERMISSION_CATALOG_TTL_MS
  ) {
    return;
  }
  for (const item of PERMISSION_CATALOG) {
    await prisma.permissionDefinition.upsert({
      where: { key: item.key },
      update: {
        module: item.module,
        description: item.description,
        isCritical: item.isCritical === true,
      },
      create: {
        key: item.key,
        module: item.module,
        description: item.description,
        isCritical: item.isCritical === true,
      },
    });
  }
  permissionCatalogEnsuredAt = Date.now();
}

// Per-salon "already seeded" cache. Once we've confirmed (or written)
// the default role-permission rows for a salon, we don't need to hit
// pg_stat_statements every login to re-COUNT them. Membership in this
// Set is process-lifetime; a redeploy clears it and the next login
// re-confirms — which is desirable because schema/catalog changes can
// add rows that need backfilling.
const salonAccessSeededIds = new Set<number>();

export async function ensureSalonAccessSeed(salonId: number): Promise<void> {
  if (salonAccessSeededIds.has(salonId)) {
    // Catalog might still need to refresh on TTL — let it own that
    // decision and skip the expensive count() entirely.
    await ensurePermissionCatalog();
    return;
  }

  await ensurePermissionCatalog();

  const permissions = await prisma.permissionDefinition.findMany({ select: { id: true, key: true } });
  const idByKey = new Map<string, number>(permissions.map((p) => [p.key, p.id]));

  // Build the canonical desired set from DEFAULT_ROLE_PERMISSIONS.
  // Previously this function only ran on the *first* seed — so any
  // permission added to the catalog after a salon was created
  // never made it into that salon's role matrix (the MANAGER role
  // famously ended up missing `access.users.manage`, which hid the
  // "Ekip Üyeleri" tab for owners who logged in via secondary
  // MANAGER role). The drift-aware version below diffs the
  // desired set against what's actually persisted and inserts only
  // the missing rows — so adding a new key to
  // DEFAULT_ROLE_PERMISSIONS automatically backfills every existing
  // salon on its next login.
  const desired: Array<{ role: string; permissionId: number }> = [];
  for (const role of FIXED_ROLES) {
    for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
      const permissionId = idByKey.get(key);
      if (!permissionId) continue;
      desired.push({ role, permissionId });
    }
  }

  if (desired.length === 0) {
    salonAccessSeededIds.add(salonId);
    return;
  }

  const existing = await prisma.salonRolePermission.findMany({
    where: { salonId },
    select: { role: true, permissionId: true },
  });
  const existingKey = new Set(existing.map((row) => `${row.role}::${row.permissionId}`));

  const missing = desired.filter((item) => !existingKey.has(`${item.role}::${item.permissionId}`));
  if (missing.length > 0) {
    await prisma.salonRolePermission.createMany({
      data: missing.map((item) => ({
        salonId,
        role: item.role,
        permissionId: item.permissionId,
        granted: true,
      })),
      skipDuplicates: true,
    });
  }
  salonAccessSeededIds.add(salonId);
}

export async function getPermissionCatalogWithGrants(salonId: number): Promise<{
  permissions: Array<{ key: string; module: string; description: string | null; isCritical: boolean }>;
  rolePermissions: Record<string, string[]>;
}> {
  await ensureSalonAccessSeed(salonId);

  const [permissions, roleRows] = await Promise.all([
    prisma.permissionDefinition.findMany({
      orderBy: [{ module: 'asc' }, { key: 'asc' }],
      select: { key: true, module: true, description: true, isCritical: true },
    }),
    prisma.salonRolePermission.findMany({
      where: { salonId, granted: true },
      select: { role: true, permissionId: true },
    }),
  ]);

  const byPermissionId = new Map<number, string>();
  const permissionRows = await prisma.permissionDefinition.findMany({ select: { id: true, key: true } });
  for (const row of permissionRows) byPermissionId.set(row.id, row.key);

  const rolePermissions: Record<string, string[]> = {};
  for (const role of FIXED_ROLES) rolePermissions[role] = [];

  for (const row of roleRows) {
    const key = byPermissionId.get(row.permissionId);
    if (!key) continue;
    const role = normalizeRole(row.role);
    rolePermissions[role] = rolePermissions[role] || [];
    rolePermissions[role].push(key);
  }

  for (const role of Object.keys(rolePermissions)) {
    rolePermissions[role] = Array.from(new Set(rolePermissions[role])).sort();
  }

  // OWNER bypasses permission checks at runtime (see
  // effectivePermissionsForRoles) and the role template must
  // reflect that — otherwise newer catalog keys that pre-date a
  // salon's seed row look "off by default" in the UI even though
  // an OWNER actually has access to them. Force OWNER to mirror
  // the full catalog every time so the API response stays in
  // lockstep with the runtime guard.
  rolePermissions['OWNER'] = permissions.map((p) => p.key).slice().sort();

  return { permissions, rolePermissions };
}

export async function getEffectivePermissionSet(input: {
  salonId: number;
  membershipId: number;
  role: string;
}): Promise<Set<string>> {
  const fallbackRole = normalizeRole(input.role);
  await ensureSalonAccessSeed(input.salonId);

  const membership = await prisma.salonMembership.findFirst({
    where: { id: input.membershipId, salonId: input.salonId },
    select: { role: true, secondaryRoles: true },
  });

  const roles = Array.from(
    new Set<FixedRole>([
      normalizeRole(membership?.role || fallbackRole),
      ...normalizeRoles(membership?.secondaryRoles),
    ]),
  );

  if (roles.includes('OWNER')) {
    return new Set(PERMISSION_CATALOG.map((item) => item.key));
  }

  const [roleRows, overrides, permissionRows] = await Promise.all([
    prisma.salonRolePermission.findMany({
      where: { salonId: input.salonId, role: { in: roles }, granted: true },
      select: { permissionId: true },
    }),
    prisma.userPermissionOverride.findMany({
      where: {
        salonId: input.salonId,
        AND: [
          { OR: [{ membershipId: input.membershipId }, { userId: input.membershipId }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
      select: { permissionId: true, granted: true },
    }),
    prisma.permissionDefinition.findMany({ select: { id: true, key: true } }),
  ]);

  const keyById = new Map<number, string>(permissionRows.map((row) => [row.id, row.key]));
  const effective = new Set<string>();

  for (const row of roleRows) {
    const key = keyById.get(row.permissionId);
    if (key) effective.add(key);
  }

  for (const override of overrides) {
    const key = keyById.get(override.permissionId);
    if (!key) continue;
    if (override.granted) effective.add(key);
    else effective.delete(key);
  }

  return effective;
}

export async function hasPermission(input: {
  salonId: number;
  membershipId: number;
  role: string;
  permissionKey: string;
}): Promise<boolean> {
  const permissions = await getEffectivePermissionSet(input);
  return permissions.has(input.permissionKey);
}

export async function writeAccessAudit(input: {
  salonId: number;
  actorUserId?: number | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await prisma.accessAuditLog.create({
    data: {
      salonId: input.salonId,
      actorUserId: input.actorUserId || null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId || null,
      metadata: ((input.metadata || {}) as any),
    },
  });
}

export function mapAdminRouteToPermission(path: string, method: string): string | null {
  const normalizedPath = path.toLowerCase();
  const m = method.toUpperCase();

  if (normalizedPath.startsWith('/access')) return null;
  if (normalizedPath.startsWith('/notification-settings')) return 'notifications.policy.manage';
  if (normalizedPath.includes('/conversations')) return 'conversations.manage';
  if (normalizedPath.startsWith('/appointments') && normalizedPath.endsWith('/payment')) return 'appointments.payment.update';
  if (normalizedPath.startsWith('/appointments')) return m === 'GET' ? 'appointments.view' : 'appointments.manage';
  if (normalizedPath.startsWith('/customers')) return m === 'GET' ? 'customers.view' : 'customers.manage';
  if (normalizedPath.startsWith('/services') || normalizedPath.startsWith('/service-')) return 'services.manage';
  if (normalizedPath.startsWith('/staff')) return 'staff.manage';
  if (normalizedPath.startsWith('/package') || normalizedPath.includes('/packages')) return 'packages.manage';
  if (normalizedPath.startsWith('/inventory')) return 'inventory.manage';
  if (normalizedPath.startsWith('/campaigns')) {
    if (normalizedPath.includes('/publish') || normalizedPath.includes('/send')) return 'campaigns.publish';
    return m === 'GET' ? 'campaigns.view' : 'campaigns.manage';
  }
  if (normalizedPath.startsWith('/automations')) return 'automations.manage';
  if (normalizedPath.startsWith('/blacklist')) return 'blacklist.manage';
  if (normalizedPath.startsWith('/analytics')) return 'analytics.view';
  if (normalizedPath.startsWith('/website')) return 'website.manage';
  if (normalizedPath.startsWith('/meta-direct')) return 'meta_direct.manage';
  if (normalizedPath.startsWith('/imports')) return 'imports.manage';
  if (normalizedPath.startsWith('/setup')) return 'website.manage';
  return 'dashboard.view';
}

