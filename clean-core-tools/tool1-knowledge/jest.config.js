module.exports = {
  // CDS test server (cds.test) can take 25-50s to boot on slower machines,
  // which consumes the per-test budget for the first tests that dispatch to it.
  // Keep this high enough that server boot time doesn't cause spurious timeouts.
  testTimeout: 90000,
};
