'use strict';

/**
 * Contract-sync integration tests (W2/W3/W4) — run against the dedicated
 * test database only (see scripts/run-integration-tests.js guard).
 */
const request = require('supertest');
const crypto = require('node:crypto');
const prisma = require('../src/config/prisma');
jest.mock('../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: (value) => String(value || '').split(/\s+/).filter(Boolean).length,
}));
const { hash } = require('@node-rs/argon2');
const { ARGON2_OPTS } = require('../src/services/authService');
const { app } = require('../src/app');

const suffix = crypto.randomBytes(6).toString('hex');
const PW = 'ContractSync!26';
const AVATAR_URL = `/media/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/contract-sync-${suffix}-avatar.png`;

const GOOD_CONTACT = {
  officeName: `Contract Sync Office ${suffix}`,
  address: '12 Beach Road, Trivandrum Road',
  city: 'Kanyakumari',
  state: 'Tamil Nadu',
  pincode: '629001',
  phone: '+91 98765 43210',
  altPhone: '+91 98765 43211',
  email: `news-${suffix}@kkn-test.invalid`,
  supportEmail: `support-${suffix}@kkn-test.invalid`,
  website: 'https://kanyakumari.example',
  mapEmbedUrl: 'https://www.google.com/maps/place/Kanyakumari/@8.0883,77.5735,17z/data=!3m1!4b1!4m6!3m5!1s0x3b070225c08c9f9d:0x0!2sKanyakumari!8m2!3d8.0883!4d77.5735',
  whatsapp: '919876543210',
  workingHours: 'Mon-Sat 9:00-18:00 IST',
};

describe('backend contract sync (avatar + site settings)', () => {
  let superAdmin;
  let plainAdmin;
  let reporter;
  let mediaId;

  beforeAll(async () => {
    const passwordHash = await hash(PW, ARGON2_OPTS);
    const mk = (role) =>
      prisma.user.create({
        data: {
          name: `CS ${role} ${suffix}`,
          email: `cs-${role}-${suffix}@kkn-test.invalid`,
          passwordHash,
          role,
          status: 'active',
        },
      });
    superAdmin = await mk('super_admin');
    plainAdmin = await mk('admin');
    reporter = await mk('reporter');

    mediaId = (
      await prisma.media.create({
        data: {
          name: 'contract-sync-avatar.png',
          key: `${suffix}/contract-sync-avatar-${suffix}.png`,
          url: AVATAR_URL,
          mimeType: 'image/png',
          sizeBytes: 1234,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.media.deleteMany({ where: { id: mediaId } });
    await prisma.activityLog.deleteMany({ where: { userId: { in: [superAdmin.id, plainAdmin.id, reporter.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [superAdmin.id, plainAdmin.id, reporter.id] } } });
    await prisma.$disconnect();
  });

  const auth = (user) => ({ Authorization: `Bearer ${user.accessToken}` });

  const login = async (user) => {
    const res = await request(app).post('/api/admin/auth/login').send({ email: user.email, password: PW });
    if (res.status !== 200) throw new Error(`login failed ${res.status}: ${JSON.stringify(res.body)}`);
    return { ...user, accessToken: res.body.data.accessToken };
  };

  test('PUT /api/admin/auth/profile persists avatar by media URL and returns avatar', async () => {
    const sa = await login(superAdmin);
    const before = await request(app).put('/api/admin/auth/profile').set(auth(sa)).send({ name: `CS ${sa.id} Renamed` });
    expect(before.status).toBe(200);
    expect(before.body.data.user.avatar).toBeNull();
    expect(before.body.data.user.name).toBe(`CS ${sa.id} Renamed`);

    const withAvatar = await request(app)
      .put('/api/admin/auth/profile')
      .set(auth(sa))
      .send({ avatar: AVATAR_URL });
    expect(withAvatar.status).toBe(200);
    expect(withAvatar.body.data.user.avatar).toBe(AVATAR_URL);

    const row = await prisma.user.findUnique({ where: { id: sa.id }, select: { avatarId: true } });
    expect(row.avatarId).toBe(mediaId);

    const cleared = await request(app).put('/api/admin/auth/profile').set(auth(sa)).send({ avatar: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.user.avatar).toBeNull();
    const clearedRow = await prisma.user.findUnique({ where: { id: sa.id }, select: { avatarId: true } });
    expect(clearedRow.avatarId).toBeNull();
  });

  test('PUT /api/admin/auth/profile rejects unknown avatar URL with 400 AVATAR_NOT_FOUND', async () => {
    const sa = await login(superAdmin);
    const res = await request(app)
      .put('/api/admin/auth/profile')
      .set(auth(sa))
      .send({ avatar: '/media/2026/01/does-not-exist.png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AVATAR_NOT_FOUND');
  });

  test('PUT /api/admin/auth/profile rejects unknown avatarId with 400 AVATAR_NOT_FOUND', async () => {
    const sa = await login(superAdmin);
    const res = await request(app)
      .put('/api/admin/auth/profile')
      .set(auth(sa))
      .send({ avatarId: 999999999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AVATAR_NOT_FOUND');
  });

  test('PUT /api/admin/settings persists new socials + contactInfo, null clears contactInfo', async () => {
    const sa = await login(superAdmin);

    const set = await request(app)
      .put('/api/admin/settings')
      .set(auth(sa))
      .send({
        socialTelegram: 'https://t.me/kanyakumaritoday',
        socialWhatsapp: 'https://wa.me/919876543210',
        socialGooglenews: 'https://news.google.com/public/home',
        contactInfo: GOOD_CONTACT,
      });
    expect(set.status).toBe(200);
    expect(set.body.data.socialTelegram).toBe('https://t.me/kanyakumaritoday');
    expect(set.body.data.socialWhatsapp).toBe('https://wa.me/919876543210');
    expect(set.body.data.socialGooglenews).toBe('https://news.google.com/public/home');
    expect(set.body.data.contactInfo.officeName).toBe(GOOD_CONTACT.officeName);
    expect(set.body.data.contactInfo.mapEmbedUrl).toBe(GOOD_CONTACT.mapEmbedUrl);

    const clear = await request(app).put('/api/admin/settings').set(auth(sa)).send({ contactInfo: null });
    expect(clear.status).toBe(200);
    expect(clear.body.data.contactInfo).toBeNull();

    const row = await prisma.siteSettings.findUnique({ where: { id: 1 }, select: { contactInfo: true, socialTelegram: true } });
    expect(row.contactInfo).toBeNull();
    expect(row.socialTelegram).toBe('https://t.me/kanyakumaritoday');
  });

  test('PUT /api/admin/settings rejects bad mapEmbedUrl and unknown contactInfo keys', async () => {
    const sa = await login(superAdmin);
    const badMap = await request(app)
      .put('/api/admin/settings')
      .set(auth(sa))
      .send({ contactInfo: { ...GOOD_CONTACT, mapEmbedUrl: 'https://example.com/maps/x' } });
    expect(badMap.status).toBe(400);
    expect(badMap.body.error.code).toBe('VALIDATION_ERROR');

    const unknownKey = await request(app)
      .put('/api/admin/settings')
      .set(auth(sa))
      .send({ contactInfo: { ...GOOD_CONTACT, surprise: 1 } });
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('settings RBAC: admin can GET but not PUT /api/admin/settings', async () => {
    const pa = await login(plainAdmin);
    const get = await request(app).get('/api/admin/settings').set(auth(pa));
    expect(get.status).toBe(200);

    const put = await request(app)
      .put('/api/admin/settings')
      .set(auth(pa))
      .send({ siteName: 'Should Fail' });
    expect(put.status).toBe(403);

    const rep = await login(reporter);
    const repGet = await request(app).get('/api/admin/settings').set(auth(rep));
    expect(repGet.status).toBe(403);
  });

  test('GET /api/settings/site exposes new socials and contactInfo to public readers', async () => {
    const sa = await login(superAdmin);
    const withAll = await request(app)
      .put('/api/admin/settings')
      .set(auth(sa))
      .send({
        socialTelegram: 'https://t.me/kanyakumaritoday',
        socialWhatsapp: 'https://wa.me/919876543210',
        contactInfo: GOOD_CONTACT,
      });
    expect(withAll.status).toBe(200);

    const pub = await request(app).get('/api/settings/site');
    expect(pub.status).toBe(200);
    expect(pub.body.data.social.telegram).toBe('https://t.me/kanyakumaritoday');
    expect(pub.body.data.social.whatsapp).toBe('https://wa.me/919876543210');
    expect(pub.body.data.social.googlenews).toBe('https://news.google.com/public/home');
    expect(pub.body.data.contactInfo.officeName).toBe(GOOD_CONTACT.officeName);
    expect(pub.body.data.contactInfo.mapEmbedUrl).toBe(GOOD_CONTACT.mapEmbedUrl);

    // clear contactInfo again → public DTO returns null
    await request(app).put('/api/admin/settings').set(auth(sa)).send({ contactInfo: null });
    const pub2 = await request(app).get('/api/settings/site');
    expect(pub2.body.data.contactInfo).toBeNull();
    expect(pub2.body.data.social.telegram).toBe('https://t.me/kanyakumaritoday');
  });
});
