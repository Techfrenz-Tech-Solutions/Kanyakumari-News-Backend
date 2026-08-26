'use strict';

const cache = require('../../src/utils/cache');

describe('cache TTL uses seconds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cache.clear();
  });

  afterEach(() => jest.useRealTimers());

  test('expires at the configured number of seconds', () => {
    cache.set('weather', { ok: true }, 600);
    jest.advanceTimersByTime(599_999);
    expect(cache.get('weather')).toEqual({ ok: true });
    jest.advanceTimersByTime(2);
    expect(cache.get('weather')).toBeUndefined();
  });

  test.each([0, -1, NaN])('rejects invalid TTL %s', (ttl) => {
    expect(() => cache.set('bad', true, ttl)).toThrow('ttlSeconds');
  });
});
