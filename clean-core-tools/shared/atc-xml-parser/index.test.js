const xml2js = require('xml2js');

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<findings>
  <finding program="ZMY_PROGRAM" object="ZMY_PROGRAM" objectType="PROG"
    line="42" column="5"
    checkId="CL_CI_TEST_UNDEF_TYPES"
    messageId="MSG001"
    description="Direct access to SAP table MARA without released API">
  </finding>
  <finding program="ZMY_PROGRAM" object="ZMY_PROGRAM" objectType="PROG"
    line="87" column="3"
    checkId="CL_CI_TEST_UNDEF_TYPES"
    messageId="MSG002"
    description="Usage of obsolete FM BAPI_MATERIAL_SAVEDATA">
  </finding>
  <finding program="ZOther_PROG" object="ZOther_PROG" objectType="PROG"
    line="10" column="1"
    checkId="CL_CI_TEST_UNDEF_TYPES"
    messageId="MSG003"
    description="SE16 usage in code">
  </finding>
</findings>`;

const { parseAtcXml } = require('./index');

test('parseAtcXml returns violations grouped by program', async () => {
  const result = await parseAtcXml(SAMPLE_XML);
  expect(result).toHaveProperty('ZMY_PROGRAM');
  expect(result['ZMY_PROGRAM']).toHaveLength(2);
  expect(result['ZMY_PROGRAM'][0]).toMatchObject({
    program: 'ZMY_PROGRAM',
    line: '42',
    description: expect.stringContaining('MARA'),
  });
  expect(result).toHaveProperty('ZOther_PROG');
  expect(result['ZOther_PROG']).toHaveLength(1);
});

test('parseAtcXml returns empty object for empty findings', async () => {
  const result = await parseAtcXml('<findings></findings>');
  expect(result).toEqual({});
});
