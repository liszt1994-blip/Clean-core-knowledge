const mockAdt = {
  checkLock: jest.fn(),
  syntaxCheck: jest.fn(),
  lockObject: jest.fn(),
  writeSourceCode: jest.fn(),
  unlockObject: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

const { writeBack } = require('../write-back');

test('writeBack aborts and returns LOCKED status when object is locked', async () => {
  mockAdt.checkLock.mockResolvedValue({ locked: true, lockedBy: 'OTHER_USER' });
  const result = await writeBack({
    adt: mockAdt, program: 'ZMY_PROG', objectType: 'PROG',
    newSource: 'REPORT zmyprog.', transportRequest: 'DEVK900001',
  });
  expect(result.status).toBe('LOCKED');
  expect(result.lockedBy).toBe('OTHER_USER');
  expect(mockAdt.lockObject).not.toHaveBeenCalled();
});

test('writeBack aborts on syntax errors', async () => {
  mockAdt.checkLock.mockResolvedValue({ locked: false });
  mockAdt.syntaxCheck.mockResolvedValue({ hasErrors: true, messages: ['Undefined variable'] });
  const result = await writeBack({
    adt: mockAdt, program: 'ZMY_PROG', objectType: 'PROG',
    newSource: 'BAD CODE', transportRequest: 'DEVK900001',
  });
  expect(result.status).toBe('SYNTAX_ERROR');
  expect(result.messages).toContain('Undefined variable');
  expect(mockAdt.lockObject).not.toHaveBeenCalled();
});

test('writeBack succeeds: lock → write → unlock', async () => {
  mockAdt.checkLock.mockResolvedValue({ locked: false });
  mockAdt.syntaxCheck.mockResolvedValue({ hasErrors: false, messages: [] });
  mockAdt.lockObject.mockResolvedValue('LOCK_HANDLE_123');
  mockAdt.writeSourceCode.mockResolvedValue();
  mockAdt.unlockObject.mockResolvedValue();
  const result = await writeBack({
    adt: mockAdt, program: 'ZMY_PROG', objectType: 'PROG',
    newSource: 'REPORT zmyprog.', transportRequest: 'DEVK900001',
  });
  expect(result.status).toBe('SUCCESS');
  expect(mockAdt.lockObject).toHaveBeenCalledWith('ZMY_PROG', 'PROG');
  expect(mockAdt.writeSourceCode).toHaveBeenCalledWith('ZMY_PROG', 'PROG', 'REPORT zmyprog.', 'LOCK_HANDLE_123', 'DEVK900001');
  expect(mockAdt.unlockObject).toHaveBeenCalledWith('ZMY_PROG', 'PROG', 'LOCK_HANDLE_123');
});

test('writeBack unlocks even if write fails', async () => {
  mockAdt.checkLock.mockResolvedValue({ locked: false });
  mockAdt.syntaxCheck.mockResolvedValue({ hasErrors: false, messages: [] });
  mockAdt.lockObject.mockResolvedValue('LOCK_HANDLE_123');
  mockAdt.writeSourceCode.mockRejectedValue(new Error('Network error'));
  mockAdt.unlockObject.mockResolvedValue();
  const result = await writeBack({
    adt: mockAdt, program: 'ZMY_PROG', objectType: 'PROG',
    newSource: 'REPORT zmyprog.', transportRequest: 'DEVK900001',
  });
  expect(result.status).toBe('ERROR');
  expect(mockAdt.unlockObject).toHaveBeenCalledWith('ZMY_PROG', 'PROG', 'LOCK_HANDLE_123');
});
