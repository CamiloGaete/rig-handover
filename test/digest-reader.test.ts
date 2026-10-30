import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28', () => {
  const night = readNight('runs', '2026-10-28');

  it('has 5 jobs sorted by name and 1 bad line', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('folds a retried job into one row', () => {
    expect(night?.rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps a failed job and its error', () => {
    expect(night?.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps a job with a null owner', () => {
    expect(night?.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not a date', () => {
    expect(readNight(dir, '../etc')).toBeNull();
  });

  it('reads an empty file as an empty night', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts lines that parse but fail validation, and skips blank lines', () => {
    const ok = { at: '2026-01-03T01:00:00+01:00', job: 'a', status: 'ok', owner: 'rook' };
    writeFileSync(
      join(dir, '2026-01-03.jsonl'),
      [
        JSON.stringify(ok),
        JSON.stringify({ ...ok, status: 'skipped' }),
        JSON.stringify({ ...ok, owner: undefined }),
        JSON.stringify({ ...ok, error: 503 }),
        JSON.stringify([ok]),
        '',
        '   ',
        '',
      ].join('\n'),
    );
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(4);
    expect(night?.rows).toHaveLength(1);
    expect(night?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });
});
