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

export function buildFeatureFlags(role: string, bookingMode?: string | null, hasWhatsapp?: boolean) {
  const normalized = normalizeRole(role);
  const capabilities = ROLE_CAPABILITIES[normalized] || ROLE_CAPABILITIES.STAFF;

  return {
    dashboard: true,
    appointments: capabilities.manageAppointments,
    customers: capabilities.manageCustomers,
    analytics: capabilities.viewAnalytics,
    inventory: capabilities.manageInventory || capabilities.viewFinance,
    campaigns: capabilities.manageCampaigns || capabilities.manageMarketing,
    automations: capabilities.manageAutomations,
    blacklist: capabilities.manageBlacklist,
    websiteBuilder: capabilities.manageSalon,
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
