/**
 * Seeds the data the system cannot start without: the RBAC matrix, a super
 * admin, the policy settings, language and geography masters, and a starter
 * catalog.
 *
 * Idempotent — every write is an upsert keyed on a natural key, so running it
 * again on an existing database changes nothing. Run with: npm run db:seed
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { DEFAULT_SETTINGS } from '../modules/settings/settings.defaults';
import { seedPlans } from './seed-plans';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Admin sidebar groups (spec 5.2) — the module half of each permission. */
const MODULES = [
  'dashboard',
  'bookings',
  'customers',
  'instructors',
  'catalog',
  'scheduling',
  'reviews',
  'finance',
  'memberships',
  'cms',
  'support',
  'marketing',
  'reports',
  'masters',
  // Admin accounts, roles and permissions. Super Admin only by default —
  // creating an admin is creating a way into every customer record.
  'admins',
] as const;

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;

/** Role to module mapping from spec 5.8. */
const ROLES: Array<{
  name: string;
  slug: string;
  description: string;
  modules: 'ALL' | Array<(typeof MODULES)[number]>;
  /** Actions this role gets on its modules; defaults to all. */
  actions?: Array<(typeof ACTIONS)[number]>;
}> = [
  {
    name: 'Super Admin',
    slug: 'super-admin',
    description: 'Full control over configuration, roles, pricing and all modules.',
    modules: 'ALL',
  },
  {
    name: 'Operations Manager',
    slug: 'operations-manager',
    description:
      'Daily booking board, assignment queue, reschedules, cancellations, escalations.',
    modules: ['dashboard', 'bookings', 'customers', 'instructors', 'scheduling', 'support', 'reports'],
  },
  {
    name: 'Teacher Manager',
    slug: 'teacher-manager',
    description:
      'Teacher recruitment, document verification, rate cards, leave approval, performance.',
    modules: ['dashboard', 'instructors', 'scheduling', 'reviews', 'reports'],
  },
  {
    name: 'Accounts',
    slug: 'accounts',
    description:
      'Transactions, invoices, refunds, commission, payouts, GST and reconciliation.',
    modules: ['dashboard', 'finance', 'memberships', 'reports'],
  },
  {
    name: 'Support Agent',
    slug: 'support-agent',
    description: 'Tickets, chat queue, disputes, SOS alerts, review moderation requests.',
    modules: ['dashboard', 'bookings', 'customers', 'support', 'reviews'],
    actions: ['view', 'create', 'edit'],
  },
  {
    name: 'Content Editor',
    slug: 'content-editor',
    description: 'Banners, workout plans, blogs, FAQs, static pages, notification templates.',
    modules: ['dashboard', 'cms', 'marketing'],
    actions: ['view', 'create', 'edit', 'delete'],
  },
];

/** Starter catalog from spec 3.1 step 3. */
const CATALOG: Array<{
  category: { name: string; slug: string; icon: string; sortOrder: number };
  services: Array<{
    name: string;
    slug: string;
    durationMin: number;
    basePrice: number;
    level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'ALL_LEVELS';
  }>;
}> = [
  {
    category: { name: 'Yoga', slug: 'yoga', icon: 'yoga', sortOrder: 1 },
    services: [
      { name: 'Hatha Yoga', slug: 'hatha-yoga', durationMin: 60, basePrice: 700 },
      { name: 'Vinyasa Flow', slug: 'vinyasa-flow', durationMin: 60, basePrice: 800, level: 'INTERMEDIATE' },
    ],
  },
  {
    category: { name: 'Power Yoga', slug: 'power-yoga', icon: 'flame', sortOrder: 2 },
    services: [
      { name: 'Power Yoga', slug: 'power-yoga-session', durationMin: 60, basePrice: 900, level: 'INTERMEDIATE' },
    ],
  },
  {
    category: { name: 'Meditation & Pranayama', slug: 'meditation-pranayama', icon: 'lotus', sortOrder: 3 },
    services: [
      { name: 'Guided Meditation', slug: 'guided-meditation', durationMin: 45, basePrice: 500 },
      { name: 'Pranayama', slug: 'pranayama', durationMin: 45, basePrice: 550 },
    ],
  },
  {
    category: { name: 'Prenatal Yoga', slug: 'prenatal-yoga', icon: 'heart', sortOrder: 4 },
    services: [
      { name: 'Prenatal Yoga', slug: 'prenatal-yoga-session', durationMin: 60, basePrice: 900 },
    ],
  },
  {
    category: { name: 'Therapy Yoga', slug: 'therapy-yoga', icon: 'stethoscope', sortOrder: 5 },
    services: [
      { name: 'Back & Neck Therapy', slug: 'back-neck-therapy', durationMin: 60, basePrice: 1000 },
    ],
  },
  {
    category: { name: 'Kids Yoga', slug: 'kids-yoga', icon: 'child', sortOrder: 6 },
    services: [
      { name: 'Kids Yoga', slug: 'kids-yoga-session', durationMin: 45, basePrice: 600, level: 'BEGINNER' },
    ],
  },
  {
    category: { name: 'Pilates', slug: 'pilates', icon: 'pilates', sortOrder: 7 },
    services: [
      { name: 'Mat Pilates', slug: 'mat-pilates', durationMin: 60, basePrice: 850 },
    ],
  },
  {
    category: { name: 'Personal Training', slug: 'personal-training', icon: 'dumbbell', sortOrder: 8 },
    services: [
      { name: 'Personal Training', slug: 'personal-training-session', durationMin: 60, basePrice: 1000 },
    ],
  },
];

async function seedPermissions() {
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      await prisma.permission.upsert({
        where: { module_action: { module, action } },
        create: { module, action, description: `${action} ${module}` },
        update: {},
      });
    }
  }
  const count = await prisma.permission.count();
  console.log(`  permissions: ${count}`);
}

async function seedRoles() {
  for (const definition of ROLES) {
    const role = await prisma.role.upsert({
      where: { slug: definition.slug },
      create: {
        name: definition.name,
        slug: definition.slug,
        description: definition.description,
        isSystem: true,
      },
      update: { name: definition.name, description: definition.description },
    });

    const modules =
      definition.modules === 'ALL' ? [...MODULES] : definition.modules;
    const actions = definition.actions ?? [...ACTIONS];

    const permissions = await prisma.permission.findMany({
      where: { module: { in: modules }, action: { in: actions } },
      select: { id: true },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }

    console.log(`  role ${definition.slug}: ${permissions.length} permissions`);
  }
}

async function seedSuperAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@hellofit.local';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.log(
      '  super admin: SKIPPED — set SEED_ADMIN_PASSWORD to create one',
    );
    return;
  }

  const role = await prisma.role.findUniqueOrThrow({
    where: { slug: 'super-admin' },
  });

  await prisma.adminUser.upsert({
    where: { email },
    create: {
      email,
      name: 'Super Admin',
      passwordHash: await bcrypt.hash(password, 12),
      roleId: role.id,
    },
    // Never silently reset an existing admin password.
    update: { roleId: role.id },
  });

  console.log(`  super admin: ${email}`);
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value, group: 'policy' },
      // Never overwrite a value the client has tuned in admin.
      update: {},
    });
  }
  console.log(`  settings: ${Object.keys(DEFAULT_SETTINGS).length} groups`);
}

async function seedLanguages() {
  const languages = [
    { code: 'en', name: 'English', isDefault: true },
    { code: 'hi', name: 'Hindi', isDefault: false },
    { code: 'mr', name: 'Marathi', isDefault: false },
  ];

  for (const language of languages) {
    await prisma.language.upsert({
      where: { code: language.code },
      create: language,
      update: { name: language.name },
    });
  }
  console.log(`  languages: ${languages.length}`);
}

async function seedGeography() {
  const city = await prisma.city.upsert({
    where: { name_state: { name: 'Pune', state: 'Maharashtra' } },
    create: { name: 'Pune', state: 'Maharashtra', isActive: true },
    update: {},
  });

  const branch = await prisma.branch.upsert({
    where: { cityId_name: { cityId: city.id, name: 'Pune Head Office' } },
    create: { name: 'Pune Head Office', cityId: city.id },
    update: {},
  });

  const areas = [
    { name: 'Kothrud', pincodes: ['411038'] },
    { name: 'Baner', pincodes: ['411045'] },
    { name: 'Viman Nagar', pincodes: ['411014'] },
  ];

  for (const area of areas) {
    const serviceArea = await prisma.serviceArea.upsert({
      where: { cityId_name: { cityId: city.id, name: area.name } },
      create: { cityId: city.id, name: area.name, branchId: branch.id },
      update: { branchId: branch.id },
    });

    for (const code of area.pincodes) {
      await prisma.pincode.upsert({
        where: { code_areaId: { code, areaId: serviceArea.id } },
        create: { code, areaId: serviceArea.id },
        update: {},
      });
    }
  }

  console.log(`  geography: 1 city, 1 branch, ${areas.length} areas`);
}

async function seedCatalog() {
  let serviceCount = 0;

  for (const entry of CATALOG) {
    const category = await prisma.serviceCategory.upsert({
      where: { slug: entry.category.slug },
      create: entry.category,
      update: { name: entry.category.name, sortOrder: entry.category.sortOrder },
    });

    for (const service of entry.services) {
      await prisma.service.upsert({
        where: { slug: service.slug },
        create: {
          categoryId: category.id,
          name: service.name,
          slug: service.slug,
          durationMin: service.durationMin,
          basePrice: service.basePrice,
          level: service.level ?? 'ALL_LEVELS',
        },
        update: { name: service.name, durationMin: service.durationMin },
      });
      serviceCount += 1;
    }
  }

  console.log(`  catalog: ${CATALOG.length} categories, ${serviceCount} services`);
}

async function seedCommission() {
  const existing = await prisma.commissionRule.findFirst({
    where: { scope: 'GLOBAL', isActive: true },
  });

  if (existing) {
    console.log('  commission: global rule already present');
    return;
  }

  await prisma.commissionRule.create({
    data: {
      scope: 'GLOBAL',
      type: 'PERCENT',
      value: DEFAULT_SETTINGS.payout.defaultCommissionPercent,
      effectiveFrom: new Date(),
    },
  });

  console.log(
    `  commission: global ${DEFAULT_SETTINGS.payout.defaultCommissionPercent}%`,
  );
}


/** Review criteria from spec 4.2 and 4.3. Admin-editable afterwards. */
const REVIEW_CRITERIA: Array<{
  direction: 'CUSTOMER_TO_INSTRUCTOR' | 'INSTRUCTOR_TO_CUSTOMER';
  name: string;
  slug: string;
  isMandatory: boolean;
}> = [
  // Customer rates the teacher (public).
  { direction: 'CUSTOMER_TO_INSTRUCTOR', name: 'Punctuality', slug: 'punctuality', isMandatory: true },
  { direction: 'CUSTOMER_TO_INSTRUCTOR', name: 'Knowledge and technique', slug: 'knowledge', isMandatory: true },
  { direction: 'CUSTOMER_TO_INSTRUCTOR', name: 'Communication and guidance', slug: 'communication', isMandatory: false },
  { direction: 'CUSTOMER_TO_INSTRUCTOR', name: 'Professionalism and behaviour', slug: 'professionalism', isMandatory: false },
  { direction: 'CUSTOMER_TO_INSTRUCTOR', name: 'Hygiene and equipment handling', slug: 'hygiene', isMandatory: false },
  // Teacher rates the customer (internal only).
  { direction: 'INSTRUCTOR_TO_CUSTOMER', name: 'Punctuality and readiness', slug: 'readiness', isMandatory: true },
  { direction: 'INSTRUCTOR_TO_CUSTOMER', name: 'Space suitability', slug: 'space', isMandatory: true },
  { direction: 'INSTRUCTOR_TO_CUSTOMER', name: 'Cooperation and follow-through', slug: 'cooperation', isMandatory: false },
  { direction: 'INSTRUCTOR_TO_CUSTOMER', name: 'Behaviour and respect', slug: 'behaviour', isMandatory: false },
  { direction: 'INSTRUCTOR_TO_CUSTOMER', name: 'Safety and comfort of the environment', slug: 'safety', isMandatory: false },
];

async function seedReviewCriteria() {
  let order = 0;

  for (const criteria of REVIEW_CRITERIA) {
    await prisma.reviewCriteria.upsert({
      where: {
        direction_slug: { direction: criteria.direction, slug: criteria.slug },
      },
      create: { ...criteria, sortOrder: order },
      update: { name: criteria.name, isMandatory: criteria.isMandatory },
    });
    order += 1;
  }

  console.log(`  review criteria: ${REVIEW_CRITERIA.length}`);
}

async function main() {
  console.log('Seeding HelloFit...');
  await seedPermissions();
  await seedRoles();
  await seedSuperAdmin();
  await seedSettings();
  await seedLanguages();
  await seedGeography();
  await seedCatalog();
  await seedCommission();
  await seedReviewCriteria();
  await seedPlans(prisma);
  console.log('Done.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
