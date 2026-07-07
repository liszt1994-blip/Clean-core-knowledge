const { writeBack } = require('./write-back');

const REPAIR_SYSTEM_PROMPT = `You are an ABAP syntax expert. Given ABAP source code and a list of activation errors, produce fixed ABAP code. Return ONLY a JSON object with field "fixedCode" (the complete corrected source). No markdown fences.`;

async function activateWithRetry({
  adt, claude, program, objectType, currentSource, transportRequest, maxRetries = 5, onAttempt,
}) {
  let source = currentSource;

  // Initial activation attempt
  let activationResult = await adt.activateObject(program, objectType);
  if (onAttempt) onAttempt({ attempt: 0, activationResult });
  if (activationResult.success) return { status: 'SUCCESS', attempts: 0 };

  // Repair loop
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const errorSummary = activationResult.errors.map(e => `Line ${e.line}: ${e.text}`).join('\n');
    const prompt = `Fix these ABAP activation errors in the following source code:\n\nErrors:\n${errorSummary}\n\nSource code:\n${source}`;

    let repairResponse;
    try {
      repairResponse = JSON.parse(await claude.complete(REPAIR_SYSTEM_PROMPT, prompt));
    } catch {
      repairResponse = { fixedCode: source };
    }

    source = repairResponse.fixedCode || source;

    // Write repaired source back
    const writeResult = await writeBack({ adt, program, objectType, newSource: source, transportRequest });
    if (onAttempt) onAttempt({ attempt, writeResult });

    if (writeResult.status !== 'SUCCESS') continue;

    // Re-activate
    activationResult = await adt.activateObject(program, objectType);
    if (onAttempt) onAttempt({ attempt, activationResult });
    if (activationResult.success) return { status: 'SUCCESS', attempts: attempt };
  }

  return {
    status: 'FAILED',
    attempts: maxRetries,
    lastErrors: activationResult.errors,
    lastSource: source,
  };
}

module.exports = { activateWithRetry };
