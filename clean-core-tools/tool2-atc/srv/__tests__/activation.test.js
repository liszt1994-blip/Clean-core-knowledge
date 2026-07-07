const mockAdt = {
  activateObject: jest.fn(),
  checkLock: jest.fn().mockResolvedValue({ locked: false }),
  syntaxCheck: jest.fn().mockResolvedValue({ hasErrors: false, messages: [] }),
  lockObject: jest.fn().mockResolvedValue('LOCK'),
  writeSourceCode: jest.fn().mockResolvedValue(),
  unlockObject: jest.fn().mockResolvedValue(),
};

const mockClaude = {
  complete: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

const { activateWithRetry } = require('../activation');

test('activateWithRetry returns success immediately when activation succeeds', async () => {
  mockAdt.activateObject.mockResolvedValue({ success: true, errors: [] });
  const result = await activateWithRetry({
    adt: mockAdt, claude: mockClaude,
    program: 'ZMY_PROG', objectType: 'PROG',
    currentSource: 'REPORT zmyprog.',
    transportRequest: 'DEVK900001',
  });
  expect(result.status).toBe('SUCCESS');
  expect(mockAdt.activateObject).toHaveBeenCalledTimes(1);
});

test('activateWithRetry retries up to maxRetries times on failure', async () => {
  mockAdt.activateObject.mockResolvedValue({
    success: false, errors: [{ line: '5', text: 'Symbol "lt_mara" unknown' }]
  });
  mockClaude.complete.mockResolvedValue(
    JSON.stringify({ fixedCode: 'REPORT zmyprog. DATA lt_mara TYPE TABLE OF mara.' })
  );
  const result = await activateWithRetry({
    adt: mockAdt, claude: mockClaude,
    program: 'ZMY_PROG', objectType: 'PROG',
    currentSource: 'REPORT zmyprog.',
    transportRequest: 'DEVK900001',
    maxRetries: 3,
  });
  expect(result.status).toBe('FAILED');
  expect(result.attempts).toBe(3);
  // initial + 3 retries = 4 total activation attempts
  expect(mockAdt.activateObject).toHaveBeenCalledTimes(4);
});

test('activateWithRetry succeeds on second attempt', async () => {
  mockAdt.activateObject
    .mockResolvedValueOnce({ success: false, errors: [{ line: '1', text: 'Error' }] })
    .mockResolvedValueOnce({ success: true, errors: [] });
  mockClaude.complete.mockResolvedValue(JSON.stringify({ fixedCode: 'REPORT z.' }));
  const result = await activateWithRetry({
    adt: mockAdt, claude: mockClaude,
    program: 'ZMY_PROG', objectType: 'PROG',
    currentSource: 'REPORT z.',
    transportRequest: 'DEVK900001',
    maxRetries: 5,
  });
  expect(result.status).toBe('SUCCESS');
  expect(result.attempts).toBe(1);
});
