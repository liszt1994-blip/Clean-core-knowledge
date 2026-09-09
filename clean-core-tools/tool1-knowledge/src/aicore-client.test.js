const { CLEAN_CORE_SYSTEM_PROMPT, systemPromptFor } = require('./aicore-client');

test('systemPromptFor("en") requests English and omits the Chinese directive', () => {
  const p = systemPromptFor('en');
  expect(p).toMatch(/Always respond in English/);
  expect(p).not.toMatch(/简体中文/);
  // Base Clean Core content is still present
  expect(p).toMatch(/Clean Core/);
});

test('systemPromptFor("zh") requests Chinese and reproduces default behavior', () => {
  const p = systemPromptFor('zh');
  expect(p).toMatch(/简体中文/);
  expect(p).not.toMatch(/Always respond in English/);
  expect(p).toMatch(/Clean Core/);
});

test('systemPromptFor default (no arg) falls back to Chinese', () => {
  expect(systemPromptFor()).toMatch(/简体中文/);
});

test('CLEAN_CORE_SYSTEM_PROMPT retains its original Chinese directive (backward compat)', () => {
  expect(CLEAN_CORE_SYSTEM_PROMPT).toMatch(/简体中文/);
});
