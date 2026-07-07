service AtcService {
  // Phase 1: Upload and start analysis
  action uploadAtc(xmlContent : String) returns { jobId : String };

  // Phase 3: Confirm selected violations and trigger write-back
  action confirmFixes(
    jobId            : String,
    transportRequest : String,
    confirmedPrograms : array of String
  ) returns { status : String };
}
