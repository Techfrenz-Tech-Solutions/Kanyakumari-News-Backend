'use strict';

const { ApiErrors } = require('../../src/utils/apiError');
const { errorHandler } = require('../../src/middleware/errorHandler');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

test('controlled errors preserve the public error envelope', () => {
  const res = responseDouble();
  errorHandler(ApiErrors.tooMany('Slow down'), {}, res, () => {});
  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Slow down', details: null },
  });
});
