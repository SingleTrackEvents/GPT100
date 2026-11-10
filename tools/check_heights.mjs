#!/usr/bin/env node
// Checks the heights along the GPT100 course (data/course.js) for stepped stretches: heights that sit flat for many
// points and then jump, as a GPX carries them when its heights came off a coarse grid. A stepped stretch draws as a
// staircase on the elevation profile and gives wrong climb figures, steepness colours and walk-in and carry-out times.
//
// Usage: node tools/check_heights.mjs                  every stretch between aid stations
//        node tools/check_heights.mjs 86.363 108.085   one stretch: the points after the first km, up to the second
//
// For each stretch: the points and their spacing, how many have exactly the height of the point before, the longest
// flat run, the single steps of 15 m or more, and the climb and descent. More than 30% of points with the height of
// the point before is marked STEPPED (a GPS file from the trail has about 5%). To fix one, see
// tools/resample_heights.py.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
(0, eval)(readFileSync(join(ROOT, 'data/course.js'), 'utf8'));
const D = globalThis.GPT100_DATA, R = D.route;

// The stretch from route point a to route point b, as one line of figures.
function check(a, b, name) {
  let flat = 0, run = 1, longest = 1, longestAt = a, big = 0, worst = 0, up = 0, down = 0;
  for (let i = a + 1; i <= b; i++) {
    const d = R[i][3] - R[i - 1][3];
    if (d === 0) { flat++; run++; if (run > longest) { longest = run; longestAt = i - run + 1; } } else run = 1;
    if (Math.abs(d) >= 15) big++;
    worst = Math.max(worst, Math.abs(d));
    if (d > 0) up += d; else down -= d;
  }
  const n = b - a, km = R[b][2] - R[a][2], share = n ? 100 * flat / n : 0;
  console.log(`km ${R[a][2].toFixed(1).padStart(5)} to ${R[b][2].toFixed(1).padStart(5)}  ${name}`);
  console.log(`    ${n} points, one per ${Math.round(km * 1000 / Math.max(1, n))} m. Same height as the point before: ${share.toFixed(0)}%. ` +
    `Longest flat run: ${longest} points (${(R[longestAt + longest - 1][2] - R[longestAt][2]).toFixed(2)} km from km ${R[longestAt][2].toFixed(1)}). ` +
    `Steps of 15 m or more: ${big} (biggest ${worst.toFixed(0)} m). Up ${Math.round(up)} m, down ${Math.round(down)} m.` + (share > 30 ? '  STEPPED' : ''));
  return share > 30;
}
const at = km => { let bi = 0; R.forEach((p, i) => { if (Math.abs(p[2] - km) < Math.abs(R[bi][2] - km)) bi = i; }); return bi; };

const [from, to] = process.argv.slice(2).map(Number);
let stepped = 0;
if (process.argv.length > 2) {
  if (!(to > from)) { console.error('Usage: node tools/check_heights.mjs [from km] [to km]'); process.exit(1); }
  // The point at or before the first km (the stretch's points come after it), to the last point up to the second km.
  let a = 0, b = 0;
  R.forEach((p, i) => { if (p[2] <= from + 1e-6) a = i; if (p[2] <= to + 1e-6) b = i; });
  stepped += check(a, b, 'the stretch asked for');
} else {
  const aid = D.access.filter(x => x.aid && (!x.courses || x.courses.includes('100'))).sort((x, y) => x.trail_km - y.trail_km);
  for (let s = 0; s < aid.length - 1; s++) stepped += check(at(aid[s].trail_km), at(aid[s + 1].trail_km), `${aid[s].name} to ${aid[s + 1].name}`);
}
console.log(stepped ? `${stepped} stepped: re-sample with python3 tools/resample_heights.py <from km> <to km>` : 'No stepped stretches.');
