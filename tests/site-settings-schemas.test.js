'use strict';

jest.mock('../src/config/prisma', () => ({}));
jest.mock('../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: (value) => String(value || '').split(/\s+/).filter(Boolean).length,
}));

const { settingsUpdate, contactInfoSchema } = require('../src/routes/admin/supporting');

const GOOD_CONTACT = {
  officeName: 'Kanyakumari News Bureau',
  address: '12 Beach Road, Trivandrum Road',
  city: 'Kanyakumari',
  state: 'Tamil Nadu',
  pincode: '629001',
  phone: '+91 98765 43210',
  altPhone: '+91 98765 43211',
  email: 'news@kanyakumari-test.in',
  supportEmail: 'support@kanyakumari-test.in',
  website: 'https://kanyakumari-test.in',
  mapEmbedUrl: 'https://www.google.com/maps/place/Kanyakumari/@8.0883,77.5735,17z/data=!3m1!4b1!4m6!3m5!1s0x3b070225c08c9f9d:0x0!2sKanyakumari!8m2!3d8.0883!4d77.5735!16zL20vMA',
  whatsapp: '919876543210',
  workingHours: 'Mon–Sat, 9:00–18:00 IST',
};

describe('settingsUpdate schema (contract sync)', () => {
  test('accepts the full admin payload with new social + contactInfo fields', () => {
    const parsed = settingsUpdate.parse({
      siteName: 'Kanyakumari Today',
      tagline: 'News from the southern tip',
      logoId: 1,
      faviconId: 2,
      contactEmail: 'desk@kanyakumari-test.in',
      contactPhone: '+91 98765 43210',
      address: '12 Beach Road',
      headerNote: null,
      footerText: '© 2026 Kanyakumari Today',
      socialFacebook: 'https://www.facebook.com/kkn',
      socialTwitter: 'https://x.com/kkn',
      socialInstagram: 'https://www.instagram.com/kkn',
      socialYoutube: 'https://www.youtube.com/@kkn',
      socialTelegram: 'https://t.me/kanyakumaritoday',
      socialWhatsapp: 'https://wa.me/919876543210',
      socialGooglenews: 'https://news.google.com/public/home',
      contactInfo: GOOD_CONTACT,
    });
    expect(parsed.socialTelegram).toBe('https://t.me/kanyakumaritoday');
    expect(parsed.socialWhatsapp).toBe('https://wa.me/919876543210');
    expect(parsed.socialGooglenews).toBe('https://news.google.com/public/home');
    expect(parsed.contactInfo.officeName).toBe(GOOD_CONTACT.officeName);
    expect(parsed.contactInfo.mapEmbedUrl).toBe(GOOD_CONTACT.mapEmbedUrl);
  });

  test('all fields optional — empty object parses', () => {
    expect(settingsUpdate.parse({})).toEqual({});
  });

  test('contactInfo: null clears the stored object', () => {
    expect(settingsUpdate.parse({ contactInfo: null }).contactInfo).toBeNull();
  });

  test('social URLs must be valid URLs', () => {
    for (const field of ['socialTelegram', 'socialWhatsapp', 'socialGooglenews']) {
      expect(() => settingsUpdate.parse({ [field]: 'not-a-url' })).toThrow();
    }
    // null clears
    expect(settingsUpdate.parse({ socialTelegram: null }).socialTelegram).toBeNull();
  });

  test('siteName length bound enforced', () => {
    expect(() => settingsUpdate.parse({ siteName: 'x'.repeat(121) })).toThrow();
    expect(settingsUpdate.parse({ siteName: 'x'.repeat(120) }).siteName).toHaveLength(120);
  });

  test('mapEmbedUrl must be an HTTPS Google Maps embed URL', () => {
    const ok = (v) => contactInfoSchema.parse({ mapEmbedUrl: v }).mapEmbedUrl;
    expect(ok('https://www.google.com/maps/place/Kanyakumari/@8.08,77.57,17z')).toMatch(/^https:/);
    expect(ok('https://maps.google.com/maps/embed?pb=abc')).toMatch(/^https:/);

    const bad = [
      'http://www.google.com/maps/place/x', // http, not https
      'https://example.com/maps/place/x', // not a Google host
      'https://www.google.com/search?q=kanyakumari', // no /maps/ path
      'https://www.google.com/mapsplace/x', // /maps/ must be a path segment
      'not a url',
      'ftp://www.google.com/maps/x',
    ];
    for (const v of bad) {
      expect(() => contactInfoSchema.parse({ mapEmbedUrl: v })).toThrow();
    }
    // null clears
    expect(contactInfoSchema.parse({ mapEmbedUrl: null }).mapEmbedUrl).toBeNull();
  });

  test('contactInfo is strict: unknown keys are rejected', () => {
    expect(() => contactInfoSchema.parse({ ...GOOD_CONTACT, surpriseKey: 'x' })).toThrow();
  });

  test('contactInfo email fields must be valid emails', () => {
    expect(() => contactInfoSchema.parse({ email: 'nope' })).toThrow();
    expect(() => contactInfoSchema.parse({ supportEmail: 'nope' })).toThrow();
  });
});
