import type { SalonUser } from '@prisma/client';

const ROLE_CAPABILITIES: Record<string, Record<string, boolean>> = {
  OWNER: {
    manageSalon: true,
    manageStaff: true,
    manageServices: true,
    manageCustomers: true,
    manageAppointments: true,
    manageInventory: true,
    manageCampaigns: true,
    manageAutomations: true,
    manageBlacklist: true,
    viewAnalytics: true,
    viewFinance: true,
    manageMarketing: true,
    manageFeatureFlags: true,
  },
  MANAGER: {
    manageSalon: true,
    manageStaff: true,
    manageServices: true,
    manageCustomers: true,
    manageAppointments: true,
    manageInventory: true,
    manageCampaigns: true,
    manageAutomations: true,
    manageBlacklist: true,
    viewAnalytics: true,
    viewFinance: false,
    manageMarketing: true,
    manageFeatureFlags: false,
  },
  RECEPTION: {
    manageSalon: false,
    manageStaff: false,
    manageServices: false,
    manageCustomers: true,
    manageAppointments: true,
    manageInventory: false,
    manageCampaigns: false,
    manageAutomations: false,
    manageBlacklist: true,
    viewAnalytics: false,
    viewFinance: false,
    manageMarketing: false,
    manageFeatureFlags: false,
  },
  STAFF: {
    manageSalon: false,
    manageStaff: false,
    manageServices: false,
    manageCustomers: true,
    manageAppointments: true,
    manageInventory: false,
    manageCampaigns: false,
    manageAutomations: false,
    manageBlacklist: false,
    viewAnalytics: false,
    viewFinance: false,
    manageMarketing: false,
    manageFeatureFlags: false,
  },
  FINANCE: {
    manageSalon: false,
    manageStaff: false,
    manageServices: false,
    manageCustomers: false,
    manageAppointments: false,
    manageInventory: true,
    manageCampaigns: false,
    manageAutomations: false,
    manageBlacklist: false,
    viewAnalytics: true,
    viewFinance: true,
    manageMarketing: false,
    manageFeatureFlags: false,
  },
};

function normalizeRole(role?: string | null): string {
  const normalized = (role || '').toUpperCase();
  if (ROLE_CAPABILITIES[normalized]) {
    return normalized;
  }
  return 'STAFF';
}

function toDisplayName(email: string): string {
  const localPart = email.split('@')[0] || 'User';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function buildCapabilities(role: string) {
  const normalized = normalizeRole(role);
  return {
    role: normalized,
    ...ROLE_CAPABILITIES[normalized],
  };
}

export function buildFeatureFlags(role: string, bookingMode?: string | null, hasWhatsapp?: boolean, permissions?: string[]) {
  const normalized = normalizeRole(role);
  const capabilities = ROLE_CAPABILITIES[normalized] || ROLE_CAPABILITIES.STAFF;
  const permissionSet = new Set((permissions || []).map((item) => String(item || '').trim()));
  const has = (key: string) => permissionSet.has(key);
  const usePermissionSet = permissionSet.size > 0;

  return {
    dashboard: true,
    appointments: usePermissionSet ? has('appointments.view') || has('appointments.manage') : capabilities.manageAppointments,
    customers: usePermissionSet ? has('customers.view') || has('customers.manage') : capabilities.manageCustomers,
    analytics: usePermissionSet ? has('analytics.view') : capabilities.viewAnalytics,
    inventory: usePermissionSet ? has('inventory.manage') : capabilities.manageInventory || capabilities.viewFinance,
    campaigns: usePermissionSet ? has('campaigns.manage') || has('campaigns.publish') : capabilities.manageCampaigns || capabilities.manageMarketing,
    automations: usePermissionSet ? has('automations.manage') : capabilities.manageAutomations,
    blacklist: usePermissionSet ? has('blacklist.manage') : capabilities.manageBlacklist,
    websiteBuilder: usePermissionSet ? has('website.manage') : capabilities.manageSalon,
    whatsappAutomation: bookingMode === 'WHATSAPP' || Boolean(hasWhatsapp),
  };
}

export function buildSubscription() {
  return {
    plan: process.env.DEFAULT_SUBSCRIPTION_PLAN || 'starter',
    status: process.env.DEFAULT_SUBSCRIPTION_STATUS || 'trial',
  };
}

export function buildBootstrapUser(user: Pick<SalonUser, 'id' | 'email' | 'role'>) {
  const normalizedRole = normalizeRole(user.role);
  return {
    id: user.id,
    name: toDisplayName(user.email),
    role: normalizedRole,
  };
}
