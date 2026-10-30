import type { DigestRow, Night } from '../digest/types.js';

// A plain text mark next to the number or status, so a flagged row survives a screenshot or a
// text fetch (ADR 0001), not just the colour.
const MARK = ' !';

const RETRY_LIMIT = 3;

function dash(v: string | null) {
  return v === null ? '—' : v;
}

function DigestTableRow({ row }: { row: DigestRow }) {
  const manyRetries = row.retries >= RETRY_LIMIT;
  const failed = row.lastStatus === 'fail';
  return (
    <tr class={manyRetries || failed ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{dash(row.owner)}</td>
      <td>{row.runs}</td>
      <td>{manyRetries ? `${row.retries}${MARK}` : row.retries}</td>
      <td>{failed ? `${row.lastStatus}${MARK}` : row.lastStatus}</td>
      <td>{dash(row.lastError)}</td>
      <td>{row.first}</td>
      <td>{row.last}</td>
    </tr>
  );
}

export function Digest({ night }: { night: Night }) {
  return (
    <>
      <h1>digest · {night.night}</h1>
      {night.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {night.rows.map((row) => (
              <DigestTableRow row={row} />
            ))}
          </tbody>
        </table>
      )}
      {night.badLines > 0 && (
        <p class="warn">
          {night.badLines === 1 ? '1 line could not be read' : `${night.badLines} lines could not be read`}
        </p>
      )}
    </>
  );
}
