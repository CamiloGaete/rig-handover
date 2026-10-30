// Plan morning-digest § 1. The contract every part of § 2 builds against; the reader lives in
// read.ts.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job in a night's run log.
export type DigestRow = {
  job: string;
  // Owner on the job's latest line. null stays null here; the view shows it as `—`.
  owner: string | null;
  // Valid lines for the job.
  runs: number;
  // Lines with status `retry`.
  retries: number;
  // Status of the job's latest line.
  lastStatus: RunStatus;
  // Most recent `error` seen for the job, or null if none of its lines had one.
  lastError: string | null;
  // `at` of the job's first and latest lines, exactly as written in the log (offset kept).
  first: string;
  last: string;
};

export type Night = {
  night: string;
  // Sorted by job name, plain string order.
  rows: DigestRow[];
  // Non-blank lines that failed to parse or validate.
  badLines: number;
  // Valid lines by status.
  counts: Record<RunStatus, number>;
};

// `runs/<night>.jsonl` → Night. null when the file doesn't exist or `night` isn't YYYY-MM-DD
// (the route turns null into a 404).
export type ReadNight = (runsDir: string, night: string) => Night | null;
