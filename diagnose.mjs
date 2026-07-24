// Live connector diagnosis: run each source against the real site from THIS
// host and report exactly what comes back (count, or the real error). This
// reproduces the datacenter-IP behaviour a cloud deploy sees.
import { runSource, CONNECTORS } from '../src/connectors/index.js';

const query = process.argv[2] || 'nike air max 90';
const ids = process.argv[3] ? process.argv[3].split(',') : Object.keys(CONNECTORS).filter(x => x !== 'facebook');
console.log(`query: "${query}"  host-IP diagnosis\n`);

for (const id of ids) {
  const r = await runSource(id, { query, limit: 12, env: process.env });
  if (r.ok) {
    const sample = r.listings[0];
    console.log(`${id.padEnd(10)} OK    ${String(r.listings.length).padStart(3)} results  ${r.ms}ms  ${sample ? '· e.g. £' + sample.price + ' ' + (sample.title || '').slice(0, 40) : '(empty 200)'}`);
  } else {
    console.log(`${id.padEnd(10)} FAIL  ${r.ms}ms  → ${r.error}`);
  }
}
