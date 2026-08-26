'use strict';

const mockPrisma = {};
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));

const { parseSubcategoryNames, syncCategorySubcategories } = require('../../src/controllers/taxonomyController');

test('parses category children consistently', () => {
  expect(parseSubcategoryNames(' One, Two ,, ')).toEqual(['One', 'Two']);
});

test('all category child synchronization uses the supplied transaction client', async () => {
  const tx = {
    subcategory: {
      findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Old' }]),
      create: jest.fn().mockResolvedValue({ id: 2 }),
      delete: jest.fn().mockResolvedValue({ id: 1 }),
    },
    article: { count: jest.fn().mockResolvedValue(0) },
  };
  await syncCategorySubcategories(tx, 5, ['New']);
  expect(tx.subcategory.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ name: 'New', parentCategoryId: 5 }),
  });
  expect(tx.article.count).toHaveBeenCalledWith({ where: { subcategoryId: 1 } });
  expect(tx.subcategory.delete).toHaveBeenCalledWith({ where: { id: 1 } });
});

test('child failure rejects so the enclosing Prisma transaction can roll back', async () => {
  const tx = {
    subcategory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockRejectedValue(new Error('child write failed')),
    },
    article: { count: jest.fn() },
  };
  await expect(syncCategorySubcategories(tx, 5, ['Broken'])).rejects.toThrow('child write failed');
});
