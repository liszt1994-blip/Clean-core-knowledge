const axios = require('axios');
jest.mock('axios');

const { AdtClient } = require('../adt-client');

const client = new AdtClient({
  baseUrl: 'https://s4host:44300',
  username: 'DEVELOPER',
  password: 'password',
});

test('getSourceCode calls correct ADT URL', async () => {
  axios.get = jest.fn().mockResolvedValue({ data: 'REPORT zmyprog.\nWRITE: / mara-matnr.' });
  const src = await client.getSourceCode('ZMY_PROGRAM', 'PROG');
  expect(axios.get).toHaveBeenCalledWith(
    expect.stringContaining('/sap/bc/adt/programs/programs/zmy_program/source/main'),
    expect.any(Object)
  );
  expect(src).toContain('REPORT zmyprog');
});

test('checkLock returns lockedBy when object is locked', async () => {
  axios.get = jest.fn().mockRejectedValue({
    response: { status: 423, headers: { 'x-sap-adt-lock-owner': 'OTHER_USER' } }
  });
  const result = await client.checkLock('ZMY_PROGRAM', 'PROG');
  expect(result.locked).toBe(true);
  expect(result.lockedBy).toBe('OTHER_USER');
});

test('checkLock returns not locked for unlocked object', async () => {
  axios.get = jest.fn().mockResolvedValue({ status: 200 });
  const result = await client.checkLock('ZMY_PROGRAM', 'PROG');
  expect(result.locked).toBe(false);
});

test('syntaxCheck returns errors array', async () => {
  axios.post = jest.fn().mockResolvedValue({
    data: `<checkReport><status>error</status><message line="5">Syntax error</message></checkReport>`
  });
  const result = await client.syntaxCheck('ZMY_PROGRAM', 'PROG', 'BAD CODE');
  expect(result.hasErrors).toBe(true);
  expect(result.messages[0]).toMatch(/Syntax error/);
});
