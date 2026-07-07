async function writeBack({ adt, program, objectType, newSource, transportRequest }) {
  // Step 1: Check lock
  const lockStatus = await adt.checkLock(program, objectType);
  if (lockStatus.locked) {
    return { status: 'LOCKED', lockedBy: lockStatus.lockedBy };
  }

  // Step 2: Syntax check
  const syntaxResult = await adt.syntaxCheck(program, objectType, newSource);
  if (syntaxResult.hasErrors) {
    return { status: 'SYNTAX_ERROR', messages: syntaxResult.messages };
  }

  // Steps 3–5: Lock → Write → Unlock (unlock always runs via finally)
  let lockHandle;
  try {
    lockHandle = await adt.lockObject(program, objectType);
    await adt.writeSourceCode(program, objectType, newSource, lockHandle, transportRequest);
    return { status: 'SUCCESS' };
  } catch (err) {
    return { status: 'ERROR', message: err.message };
  } finally {
    if (lockHandle) {
      await adt.unlockObject(program, objectType, lockHandle).catch(() => {});
    }
  }
}

module.exports = { writeBack };
