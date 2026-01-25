import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding RBAC system...');

  // Create default roles
  const roles = [
    { name: 'OWNER', displayName: 'Owner', description: 'Full access to all salon operations', isSystemRole: true },
    { name: 'MANAGER', displayName: 'Manager', description: 'Manage staff, appointments, and customers', isSystemRole: true },
    { name: 'RECEPTION', displayName: 'Reception', description: 'Handle customer bookings and basic operations', isSystemRole: true },
    { name: 'STAFF', displayName: 'Staff', description: 'Basic staff operations', isSystemRole: true },
    { name: 'FINANCE', displayName: 'Finance', description: 'Financial reporting and billing', isSystemRole: true },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }

  console.log('✅ Roles created');

  // Create default permissions
  const permissions = [
    // Appointments
    { key: 'appointments:read', name: 'View Appointments', resource: 'appointments', action: 'read', isSystemPermission: true },
    { key: 'appointments:write', name: 'Create/Edit Appointments', resource: 'appointments', action: 'write', isSystemPermission: true },
    { key: 'appointments:delete', name: 'Delete Appointments', resource: 'appointments', action: 'delete', isSystemPermission: true },
    { key: 'appointments:manage', name: 'Full Appointment Management', resource: 'appointments', action: 'manage', isSystemPermission: true },

    // Customers
    { key: 'customers:read', name: 'View Customers', resource: 'customers', action: 'read', isSystemPermission: true },
    { key: 'customers:write', name: 'Create/Edit Customers', resource: 'customers', action: 'write', isSystemPermission: true },
    { key: 'customers:delete', name: 'Delete Customers', resource: 'customers', action: 'delete', isSystemPermission: true },

    // Staff
    { key: 'staff:read', name: 'View Staff', resource: 'staff', action: 'read', isSystemPermission: true },
    { key: 'staff:write', name: 'Create/Edit Staff', resource: 'staff', action: 'write', isSystemPermission: true },
    { key: 'staff:delete', name: 'Delete Staff', resource: 'staff', action: 'delete', isSystemPermission: true },

    // Services
    { key: 'services:read', name: 'View Services', resource: 'services', action: 'read', isSystemPermission: true },
    { key: 'services:write', name: 'Create/Edit Services', resource: 'services', action: 'write', isSystemPermission: true },
    { key: 'services:delete', name: 'Delete Services', resource: 'services', action: 'delete', isSystemPermission: true },

    // Salon Settings
    { key: 'salon:read', name: 'View Salon Settings', resource: 'salon', action: 'read', isSystemPermission: true },
    { key: 'salon:write', name: 'Edit Salon Settings', resource: 'salon', action: 'write', isSystemPermission: true },

    // Reports
    { key: 'reports:read', name: 'View Reports', resource: 'reports', action: 'read', isSystemPermission: true },
    { key: 'reports:finance', name: 'View Financial Reports', resource: 'reports', action: 'finance', isSystemPermission: true },

    // User Management
    { key: 'users:read', name: 'View Users', resource: 'users', action: 'read', isSystemPermission: true },
    { key: 'users:write', name: 'Create/Edit Users', resource: 'users', action: 'write', isSystemPermission: true },
    { key: 'users:manage', name: 'Full User Management', resource: 'users', action: 'manage', isSystemPermission: true },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: {},
      create: permission,
    });
  }

  console.log('✅ Permissions created');

  // Assign permissions to roles
  const rolePermissions = [
    // OWNER - All permissions
    { roleName: 'OWNER', permissions: ['*'] }, // Special case: all permissions

    // MANAGER - Most permissions except user management
    { roleName: 'MANAGER', permissions: [
      'appointments:*', 'customers:*', 'staff:*', 'services:*', 'salon:*', 'reports:*'
    ]},

    // RECEPTION - Customer-facing operations
    { roleName: 'RECEPTION', permissions: [
      'appointments:read', 'appointments:write', 'customers:read', 'customers:write', 'services:read'
    ]},

    // STAFF - Basic operations
    { roleName: 'STAFF', permissions: [
      'appointments:read', 'customers:read', 'services:read'
    ]},

    // FINANCE - Financial operations
    { roleName: 'FINANCE', permissions: [
      'reports:read', 'reports:finance', 'customers:read', 'appointments:read'
    ]},
  ];

  for (const rp of rolePermissions) {
    const role = await prisma.role.findUnique({ where: { name: rp.roleName } });
    if (!role) continue;

    if (rp.permissions.includes('*')) {
      // Assign all permissions to this role
      const allPermissions = await prisma.permission.findMany();
      for (const perm of allPermissions) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          update: { granted: true },
          create: { roleId: role.id, permissionId: perm.id, granted: true },
        });
      }
    } else {
      // Assign specific permissions
      for (const permKey of rp.permissions) {
        if (permKey.endsWith(':*')) {
          // Wildcard - assign all permissions for this resource
          const resource = permKey.split(':')[0];
          const perms = await prisma.permission.findMany({
            where: { resource }
          });
          for (const perm of perms) {
            await prisma.rolePermission.upsert({
              where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
              update: { granted: true },
              create: { roleId: role.id, permissionId: perm.id, granted: true },
            });
          }
        } else {
          // Specific permission
          const perm = await prisma.permission.findUnique({ where: { key: permKey } });
          if (perm) {
            await prisma.rolePermission.upsert({
              where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
              update: { granted: true },
              create: { roleId: role.id, permissionId: perm.id, granted: true },
            });
          }
        }
      }
    }
  }

  console.log('✅ Role permissions assigned');
  console.log('🎉 RBAC system seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });