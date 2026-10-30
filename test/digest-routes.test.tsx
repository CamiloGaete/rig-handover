import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';

const dir = mkdtempSync(join(tmpdir(), 'rig-'));
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir };

const MAIN = '2026-02-01';
const EMPTY = '2026-02-02';
const BAD = '2026-02-03';
const MISSING = '2026-02-04';

type Line = { at: string; job: string; status: 'ok' | 'retry' | 'fail'; owner: string | null; error?: string };

const at = (minute: number) => `2026-02-02T01:${String(minute).padStart(2, '0')}:00+01:00`;

// zeta/last comes first in the file; alpha/early comes last but sorts first.
const mainLines: Line[] = [
  { at: at(0), job: 'zeta/last', status: 'ok', owner: 'rook' },
  { at: at(1), job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: at(2), job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: at(3), job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: at(4), job: 'fixtures/refresh', status: 'ok', owner: 'rook' },
  { at: at(5), job: 'notes/backup', status: 'fail', owner: 'rook', error: 'quota exceeded' },
  { at: at(6), job: 'digest/render', status: 'ok', owner: null },
  { at: at(7), job: 'alpha/early', status: 'ok', owner: 'rook' },
];

const toJsonl = (lines: string[]) => lines.join('\n') + '\n';

beforeAll(() => {
  writeFileSync(join(dir, `${MAIN}.jsonl`), toJsonl(mainLines.map((l) => JSON.stringify(l))));
  writeFileSync(join(dir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(dir, `${BAD}.jsonl`),
    toJsonl([JSON.stringify(mainLines[0]), 'this is not json {', JSON.stringify(mainLines[7])]),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const app = createApp(config);

type DigestJson = {
  night: string;
  rows: {
    job: string;
    owner: string | null;
    runs: number;
    retries: number;
    lastStatus: string;
    lastError: string | null;
    first: string;
    last: string;
  }[];
  badLines: number;
  counts: { ok: number; retry: number; fail: number };
};

// Body rows only: the header row uses <th>, so it never matches `<tr ...><td>`.
function tableRows(html: string): { job: string; attrs: string }[] {
  return [...html.matchAll(/<tr([^>]*)>\s*<td[^>]*>([^<]*)<\/td>/g)].map((m) => ({
    attrs: m[1] ?? '',
    job: m[2] ?? '',
  }));
}

describe('GET /digest/:night', () => {
  it('renders one table with the header, sorted rows and warn marks', async () => {
    const res = await app.request(`/digest/${MAIN}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);

    const headers = ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first', 'last'];
    const cells = [...html.matchAll(/<th[^>]*>\s*([^<]*?)\s*<\/th>/g)].map((m) => m[1]);
    expect(cells).toEqual(headers);

    const rows = tableRows(html);
    expect(rows.map((r) => r.job)).toEqual([
      'alpha/early',
      'digest/render',
      'fixtures/refresh',
      'notes/backup',
      'zeta/last',
    ]);

    const warned = rows.filter((r) => /class="warn"/.test(r.attrs)).map((r) => r.job);
    // 3 retries then ok, and a job ending in fail. The clean rows stay unmarked.
    expect(warned).toEqual(['fixtures/refresh', 'notes/backup']);
  });

  it('shows a null owner as an em dash', async () => {
    const html = await (await app.request(`/digest/${MAIN}`)).text();
    const row = html.match(/<tr[^>]*>\s*<td[^>]*>digest\/render<\/td>(.*?)<\/tr>/s);
    expect(row?.[1]).toContain('—');
  });

  it('shows the lane banner', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const html = await (await app.request(`/digest/${MAIN}`)).text();
    expect(html).toContain('TEST-MARKER');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('says nothing ran for an empty night, with no table', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('renders the valid jobs of a night with a bad line and says so', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(tableRows(html).map((r) => r.job)).toEqual(['alpha/early', 'zeta/last']);
    expect(html).toContain('1 line could not be read');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns night, rows, badLines and counts', async () => {
    const res = await app.request(`/api/digest/${MAIN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
    expect(body.night).toBe(MAIN);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 4, retry: 3, fail: 1 });
    expect(body.rows).toEqual(readNight(dir, MAIN)?.rows);
    expect(body.rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: at(1),
      last: at(4),
    });
    expect(body.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
    expect(body.rows.find((r) => r.job === 'notes/backup')?.lastStatus).toBe('fail');
  });

  it('answers 404 with an error body for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('returns no rows and no bad lines for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts the bad line and keeps the valid rows', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/early', 'zeta/last']);
  });
});

describe('page and JSON agree', () => {
  it.each([MAIN, BAD])('lists the same jobs in the same order for %s', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as DigestJson;
    expect(tableRows(html).map((r) => r.job)).toEqual(body.rows.map((r) => r.job));
  });
});
