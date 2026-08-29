'use strict';

const crypto = require('node:crypto');

const mockPrisma = {
  otpCode: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  readerAccount: { upsert: jest.fn() },
};
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));

const env = require('../../src/config/env');
const service = require('../../src/services/readerAuthService');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

describe('reader OTP flow', () => {
  beforeEach(() => {
    mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.otpCode.create.mockResolvedValue({ id: 1 });
    mockPrisma.otpCode.update.mockResolvedValue({ id: 1 });
    mockPrisma.readerAccount.upsert.mockResolvedValue({ id: 8, phone: '+919999999999', provider: 'otp' });
  });

  test('allowed requests use configured expiry and return dev code only outside production', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue(null);
    const before = Date.now();
    const result = await service.requestOtp({ phone: '+919999999999', req: {} });
    const data = mockPrisma.otpCode.create.mock.calls[0][0].data;
    expect(result.devCode).toMatch(/^\d{6}$/);
    expect(data.codeHash).not.toBe(result.devCode);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + env.OTP_EXPIRY_MINUTES * 60_000);
  });

  test('request throttling is a controlled 429', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.requestOtp({ phone: '+919999999999', req: {} })).rejects.toMatchObject({
      status: 429, code: 'OTP_RATE_LIMITED',
    });
  });

  test('wrong OTP increments attempts and returns controlled 401', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 1, codeHash: digest('123456'), attempts: 0, expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.verifyOtp({ phone: '+919999999999', otp: '000000', req: {} }))
      .rejects.toMatchObject({ status: 401, code: 'OTP_INVALID' });
    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { attempts: { increment: 1 } },
    });
  });

  test('configured max attempts locks the OTP with a controlled 429', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 1, codeHash: digest('123456'), attempts: env.OTP_MAX_ATTEMPTS,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.verifyOtp({ phone: '+919999999999', otp: '123456', req: {} }))
      .rejects.toMatchObject({ status: 429, code: 'OTP_LOCKED' });
  });

  test('expired and consumed/missing OTPs are controlled errors', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce({
      id: 1, attempts: 0, expiresAt: new Date(Date.now() - 1),
    });
    await expect(service.verifyOtp({ phone: '+919999999999', otp: '1', req: {} }))
      .rejects.toMatchObject({ code: 'OTP_EXPIRED' });
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce(null);
    await expect(service.verifyOtp({ phone: '+919999999999', otp: '1', req: {} }))
      .rejects.toMatchObject({ code: 'OTP_NOT_FOUND' });
  });

  test('correct OTP is consumed and returns a reader token', async () => {
    mockPrisma.otpCode.findFirst.mockResolvedValue({
      id: 1, codeHash: digest('123456'), attempts: 1, expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await service.verifyOtp({ phone: '+919999999999', otp: '123456', req: {} });
    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { consumedAt: expect.any(Date) },
    });
    expect(result.token).toEqual(expect.any(String));
  });

  test('unsupported providers fail clearly', () => {
    expect(() => service.selectOtpProvider('not-implemented')).toThrow(expect.objectContaining({ status: 503 }));
  });

  test('disabled provider fails closed without generating a code', () => {
    expect(() => service.selectOtpProvider('disabled')).toThrow(expect.objectContaining({ status: 503 }));
  });
});
