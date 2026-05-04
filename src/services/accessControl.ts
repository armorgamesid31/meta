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
  { key: 'access.roles.manage', module: 'access', description: 'Rol yetki matrisini yonet', isCritical: true },
  { key: 'access.users.manage', module: 'access', description: 'Ekip kullanicilari ve rolleri yonet', isCritical: true },
  { key: 'access.permission_overrides.edit', module: 'access', description: 'Kullanici yetki istisnalarini duzenle', isCritical: true },
  { key: 'access.audit.view', module: 'access', description: 'Erisim denetim kayitlarini goruntule' },
] as const;

const DEFAULT_ROLE_PERMISSIONS: Record<FixedRole, string[]> = {
  OWNER: PERMISSION_CATALOG.map((item) => item.key),
  MANAGER: [
    'dashboard.view',
    'appointments.view',
    'appointments.manage',
    'appointments.payment.update',
    'customers.view',
    'customers.manage',
    'services.manage',
    'staff.manage',
    'packages.manage',
    'analytics.view',
    'inventory.manage',
    'campaigns.manage',
    'automations.manage',
    'blacklist.manage',
    'conversations.manage',
    'instagram_inbox.manage',
    'notifications.inbox.view',
    'notifications.preferences.manage',
    'website.manage',
    'meta_direct.manage',
    'imports.manage',
  ],
  RECEPTION: [
    'dashboard.view',
    'appointments.view',
    'appointments.manage',
    'customers.view',
    'customers.manage',
    'packages.manage',
    'blacklist.manage',
    'conversations.manage',
    'instagram_inbox.manage',
    'notifications.inbox.view',
    'notifications.preferences.manage',
  ],
  STAFF: [
    'dashboard.view',
    'appointments.view',
    'appointments.manage',
    'customers.view',
    'customers.manage',
    'conversations.manage',
    'notifications.inbox.view',
    'notifications.preferences.manage',
  ],
  FINANCE: [
    'dashboard.view',
    'analytics.view',
    'inventory.manage',
    'appointments.view',
    'appointments.payment.update',
    'notifications.inbox.view',
    'notifications.preferences.manage',
    'access.audit.view',
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

export async function ensurePermissionCatalog(): Promise<void> {
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
}

export async function ensureSalonAccessSeed(salonId: number): Promise<void> {
  await ensurePermissionCatalog();

  const existing = await prisma.salonRolePermission.count({ where: { salonId } });
  if (existing > 0) return;

  const permissions = await prisma.permissionDefinition.findMany({ select: { id: true, key: true } });
  const idByKey = new Map<string, number>(permissions.map((p) => [p.key, p.id]));

  const rows: Array<{ salonId: number; role: string; permissionId: number; granted: boolean }> = [];
  for (const role of FIXED_ROLES) {
    for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
      const permissionId = idByKey.get(key);
      if (!permissionId) continue;
      rows.push({ salonId, role, permissionId, granted: true });
    }
  }

  if (rows.length > 0) {
    await prisma.salonRolePermission.createMany({ data: rows, skipDuplicates: true });
  }
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

  return { permissions, rolePermissions };
}

export async function getEffectivePermissionSet(input: {
  salonId: number;
  userId: number;
  role: string;
}): Promise<Set<string>> {
  const fallbackRole = normalizeRole(input.role);
  await ensureSalonAccessSeed(input.salonId);

  const user = await prisma.salonUser.findFirst({
    where: { id: input.userId, salonId: input.salonId },
    select: { role: true, secondaryRoles: true },
  });

  const roles = Array.from(
    new Set<FixedRole>([
      normalizeRole(user?.role || fallbackRole),
      ...normalizeRoles(user?.secondaryRoles),
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
        userId: input.userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
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
  userId: number;
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
    return 'campaigns.manage';
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

