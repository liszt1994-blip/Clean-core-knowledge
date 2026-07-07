const xml2js = require('xml2js');

async function parseAtcXml(xmlString) {
  const parsed = await xml2js.parseStringPromise(xmlString, { explicitArray: false });
  const findings = parsed?.findings?.finding;
  if (!findings) return {};

  const list = Array.isArray(findings) ? findings : [findings];
  const grouped = {};

  for (const f of list) {
    const program = f.$.program || f.$.object;
    if (!grouped[program]) grouped[program] = [];
    grouped[program].push({
      program,
      object: f.$.object,
      objectType: f.$.objectType,
      line: f.$.line,
      column: f.$.column,
      checkId: f.$.checkId,
      messageId: f.$.messageId,
      description: f.$.description,
    });
  }
  return grouped;
}

module.exports = { parseAtcXml };
