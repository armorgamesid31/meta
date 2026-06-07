import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import 'dotenv/config';

// ─────────────────────────────────────────────────────────────────────
// grantPlatformRole — manage the cross-tenant platform flag on a Kedy
// account (UserIdentity.platformRole). A platform account can sign into
// ANY active salon without a SalonMembership; every entry is audited.
//
// Usage:
//   node scripts/grantPlatformRole.mjs <email> [role]
//   node scripts/grantPlatformRole.mjs <email> none                  # revoke
//   node scripts/grantPlatformRole.mjs <email> <role> --create --password=... --name="..."
//
//   role: PLATFORM_ADMIN (default) | PLATFORM_SUPPORT | none
//
// Examples:
//   node scripts/grantPlatformRole.mjs berkay@kedyapp.com PLATFORM_ADMIN
//   node scripts/grantPlatformRole.mjs destek@kedyapp.com PLATFORM_SUPPORT --create --password=GizliSifre1 --name="Kedy Destek"
// ─────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
const VALID = ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'none'];

function parseArgs() {
  const [, , email, roleArg = 'PLATFORM_ADMIN', ...rest] = process.argv;
  const flags = Object.fromEntries(
    rest.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    }),
  );
  return { email, role: roleArg, flags };
}

async function main() {
  const { email, role, flags } = parseArgs();
  if (!email) {
    console.error(
      'HATA: email zorunlu.\n' +
        'Kullanim: node scripts/grantPlatformRole.mjs <email> [PLATFORM_ADMIN|PLATFORM_SUPPORT|none] [--create --password=.. --name=".."]',
    );
    process.exit(1);
  }
  if (!VALID.includes(role)) {
    console.error(`HATA: gecersiz rol "${role}". Gecerli: ${VALID.join(', ')}`);
    process.exit(1);
  }

  const platformRole = role === 'none' ? null : role;
  const normalizedEmail = String(email).toLowerCase().trim();

  let identity = await prisma.userIdentity.findFirst({
    where: { email: normalizedEmail },
    select: { id: true, email: true, platformRole: true, isActive: true },
  });

  if (!identity) {
    if (!flags.create) {
      console.error(
        `HATA: "${normalizedEmail}" bulunamadi. Var olmayan hesabi olusturmak icin --create --password=... ekleyin.`,
      );
      process.exit(1);
    }
    const password = typeof flags.password === 'string' ? flags.password : '';
    if (password.length < 8) {
      console.error('HATA: --create icin en az 8 karakterli --password=... gerekli.');
      process.exit(1);
    }
    const name = typeof flags.name === 'string' ? flags.name : 'Kedy Platform';
    const [firstName, ...lastParts] = name.split(' ');
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    identity = await prisma.userIdentity.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        firstName: firstName || 'Kedy',
        lastName: lastParts.join(' ') || 'Platform',
        displayName: name,
        isActive: true,
        emailVerifiedAt: now,
        platformRole,
      },
      select: { id: true, email: true, platformRole: true, isActive: true },
    });
    console.log(`OLUSTURULDU: ${identity.email} (id=${identity.id}) -> platformRole=${identity.platformRole}`);
  } else {
    identity = await prisma.userIdentity.update({
      where: { id: identity.id },
      data: { platformRole },
      select: { id: true, email: true, platformRole: true, isActive: true },
    });
    console.log(
      `GUNCELLENDI: ${identity.email} (id=${identity.id}) -> platformRole=${identity.platformRole ?? 'KALDIRILDI'}`,
    );
  }

  if (identity.isActive !== true) {
    console.warn('UYARI: hesap isActive=false — giris yapamaz. Aktiflestirmek gerekebilir.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('BASARISIZ:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
