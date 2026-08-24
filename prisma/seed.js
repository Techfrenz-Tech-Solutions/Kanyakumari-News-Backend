'use strict';

/**
 * Deterministic, idempotent seed.
 *
 * - 22 public categories (slugs preserved exactly from the public frontend)
 * - 6 Kanyakumari areas (public frontend filter chips)
 * - Districts (Kanyakumari + its 4 taluks, from the frontend district info)
 * - 6 tourist attractions (from the frontend)
 * - Default site settings
 * - Exactly one initial Super Admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
 */

const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const prisma = new PrismaClient();

// ── 22 categories from kanyakumari-news-frontend/src/data/newsData.js ─────────
const CATEGORIES = [
  ['kanyakumari', 'Kanyakumari'],
  ['tamil-nadu', 'Tamil Nadu'],
  ['national', 'National'],
  ['world', 'World'],
  ['politics', 'Politics'],
  ['business', 'Business'],
  ['economy', 'Economy'],
  ['technology', 'Technology'],
  ['science', 'Science'],
  ['education', 'Education'],
  ['health', 'Health'],
  ['sports', 'Sports'],
  ['entertainment', 'Entertainment'],
  ['cinema', 'Cinema'],
  ['lifestyle', 'Lifestyle'],
  ['travel', 'Travel'],
  ['automobile', 'Automobile'],
  ['agriculture', 'Agriculture'],
  ['crime', 'Crime'],
  ['editorial', 'Editorial'],
  ['jobs', 'Jobs'],
  ['astrology', 'Astrology'],
];

// ── 6 Kanyakumari sub-areas from the public frontend ─────────────────────────
const AREAS = [
  ['nagercoil', 'Nagercoil'],
  ['colachel', 'Colachel'],
  ['kuzhithurai', 'Kuzhithurai'],
  ['marthandam', 'Marthandam'],
  ['vattakottai', 'Vattakottai'],
  ['munchirai', 'Munchirai'],
];

// ── Districts (Kanyakumari + taluks from frontend district info) ─────────────
const DISTRICTS = ['Kanyakumari', 'Agastheeswaram', 'Kalkulam', 'Vilavancode', 'Killiyoor'];

// ── District reference data (copied 1:1 from the public frontend's
// ── newsData.js districtInfo — served verbatim by GET /api/district-info).
const DISTRICT_INFO = {
  taluks: [
    { name: 'Agastheeswaram', headquarters: 'Nagercoil', panchayats: 14 },
    { name: 'Kalkulam', headquarters: 'Thuckalay', panchayats: 11 },
    { name: 'Vilavancode', headquarters: 'Villukuri', panchayats: 10 },
    { name: 'Killiyoor', headquarters: 'Killiyoor', panchayats: 8 },
  ],
  govtOffices: [
    { name: 'District Collectorate', address: 'Collectorate Complex, Nagercoil - 629 001', phone: '04652-232190' },
    { name: 'District Police Office', address: 'SP Office, Nagercoil - 629 001', phone: '04652-222100' },
    { name: 'District Hospital', address: 'Hospital Road, Nagercoil - 629 001', phone: '04652-223009' },
    { name: 'Regional Transport Office', address: 'RTO Complex, Nagercoil - 629 001', phone: '04652-230011' },
    { name: 'Electricity Board (TNEB)', address: 'TNEB Office, Nagercoil - 629 001', phone: '04652-235678' },
  ],
  helplines: [
    { name: 'Police', number: '100' },
    { name: 'Fire Service', number: '101' },
    { name: 'Ambulance', number: '108' },
    { name: 'Women Helpline', number: '181' },
    { name: 'Child Helpline', number: '1098' },
    { name: 'Disaster Helpline', number: '1077' },
    { name: 'District Collectorate', number: '04652-232190' },
  ],
  transport: [
    { route: 'Nagercoil → Chennai', type: 'Bus', duration: '9 hrs', operator: 'TNSTC' },
    { route: 'Nagercoil → Madurai', type: 'Bus', duration: '4 hrs', operator: 'TNSTC' },
    { route: 'Kanyakumari → Thiruvananthapuram', type: 'Train', duration: '1.5 hrs', operator: 'Southern Rly' },
    { route: 'Nagercoil → Coimbatore', type: 'Bus', duration: '6 hrs', operator: 'TNSTC' },
  ],
};

// ── Tourist attractions from kanyakumari-news-frontend/src/data/newsData.js ──
const ATTRACTIONS = [
  {
    name: 'Vivekananda Rock Memorial',
    description: 'A famous monument built on a small island off the coast where Swami Vivekananda meditated.',
    category: 'Monument',
    timings: '8:00 AM – 4:00 PM',
    entryFee: '₹30 (Adult)',
  },
  {
    name: 'Thiruvalluvar Statue',
    description: 'A 133-feet stone statue of the Tamil poet-saint Thiruvalluvar on a small islet near Kanyakumari.',
    category: 'Monument',
    timings: '8:00 AM – 4:00 PM',
    entryFee: '₹30 (Adult)',
  },
  {
    name: 'Sunrise / Sunset Point',
    description: 'The only place in India where you can witness both sunrise and sunset over the sea.',
    category: 'Nature',
    timings: 'Open all day',
    entryFee: 'Free',
  },
  {
    name: 'Padmanabhapuram Palace',
    description: 'An ancient wooden palace near Thuckalay — one of the finest examples of Kerala architecture.',
    category: 'Heritage',
    timings: '9:00 AM – 5:00 PM (Closed Mondays)',
    entryFee: '₹35 (Adult)',
  },
  {
    name: 'Kanyakumari Beach',
    description: 'The confluence of three seas — a pristine beach with multicoloured sand at the southernmost tip of India.',
    category: 'Beach',
    timings: 'Open all day',
    entryFee: 'Free',
  },
  {
    name: 'Kumari Amman Temple',
    description: 'Ancient Hindu temple dedicated to the virgin goddess Kanya Devi at the tip of India.',
    category: 'Temple',
    timings: '4:30 AM – 12:00 PM, 4:00 PM – 8:00 PM',
    entryFee: 'Free',
  },
];

async function seed() {
  // ── Categories ──
  for (let i = 0; i < CATEGORIES.length; i++) {
    const [slug, name] = CATEGORIES[i];
    await prisma.category.upsert({
      where: { slug },
      update: { name, sortOrder: i },
      create: { slug, name, sortOrder: i, status: 'active' },
    });
  }

  // ── Areas ──
  for (const [slug, name] of AREAS) {
    await prisma.area.upsert({
      where: { slug },
      update: { name },
      create: { slug, name },
    });
  }

  // ── Districts ──
  for (const name of DISTRICTS) {
    await prisma.district.upsert({
      where: { name },
      update: {},
      create: { name, status: 'active' },
    });
  }

  // ── Tourist attractions ──
  for (let i = 0; i < ATTRACTIONS.length; i++) {
    const a = ATTRACTIONS[i];
    const existing = await prisma.touristAttraction.findFirst({
      where: { name: a.name, sortOrder: i },
    });
    if (existing) {
      await prisma.touristAttraction.update({
        where: { id: existing.id },
        data: { description: a.description, category: a.category, timings: a.timings, entryFee: a.entryFee },
      });
    } else {
      await prisma.touristAttraction.create({
        data: {
          name: a.name,
          description: a.description,
          category: a.category,
          timings: a.timings,
          entryFee: a.entryFee,
          status: 'active',
          sortOrder: i,
        },
      });
    }
  }

  // ── Site settings (single row, id = 1) ──
  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    // Never clobber operator-edited settings on re-seed; only backfill
    // districtInfo (reference data) when missing.
    update: settings && settings.districtInfo === null ? { districtInfo: DISTRICT_INFO } : {},
    create: {
      id: 1,
      siteName: 'Kanyakumari Today',
      tagline: 'Local News for Kanyakumari District',
      contactEmail: 'contact@kanyakumaritoday.com',
      contactPhone: '04652-232100',
      address: 'No. 5, Main Road, Nagercoil – 629 001',
      footerText: 'Independent local news for Kanyakumari District — covering what matters to you.',
      socialFacebook: '',
      socialTwitter: '',
      socialInstagram: '',
      socialYoutube: '',
      districtInfo: DISTRICT_INFO,
    },
  });

  // ── Initial Super Admin ──
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@kanyakumaritoday.com').toLowerCase();
  const name = process.env.SEED_ADMIN_NAME || 'Super Admin';
  const existingAdmin = await prisma.user.findUnique({ where: { email } });

  if (existingAdmin) {
    // Idempotent: refresh role only, never the password.
    if (existingAdmin.role !== 'super_admin') {
      await prisma.user.update({ where: { id: existingAdmin.id }, data: { role: 'super_admin', name } });
    }
    console.log(`[seed] Super admin already exists: ${email}`);
  } else {
    let password = process.env.SEED_ADMIN_PASSWORD;
    let generated = false;
    if (!password) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SEED_ADMIN_PASSWORD must be set in production to create the initial admin.');
      }
      password = `KKN-${crypto.randomBytes(9).toString('hex')}`;
      generated = true;
    }
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.user.create({
      data: { name, email, passwordHash, role: 'super_admin', status: 'active' },
    });
    if (generated) {
      console.log(`[seed] CREATED initial super admin ${email} with GENERATED dev password:`);
      console.log(`       ${password}`);
      console.log('       (dev only — set SEED_ADMIN_PASSWORD to control this)');
    } else {
      console.log(`[seed] CREATED initial super admin ${email}`);
    }
  }

  const [cats, areas] = await Promise.all([
    prisma.category.count(),
    prisma.area.count(),
  ]);
  console.log(`[seed] done — categories=${cats} areas=${areas} attractions=${ATTRACTIONS.length} districts=${DISTRICTS.length}`);
}

seed()
  .catch((e) => {
    console.error('[seed] failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
