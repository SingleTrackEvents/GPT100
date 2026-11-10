#!/usr/bin/env node
// Drive times between the crew points of every race, for the runner app's Crew tab ("leave by").
//   node tools/crew_drives.mjs            writes data/crew-drives.js
// It reads the crew points from data/races.js (crew: "yes", and the start and finish of each race), places them with
// the app's own code, and asks Valhalla (valhalla1.openstreetmap.de, OpenStreetMap roads, the same service as
// tools/drive_routes.py) for the drive between each pair. Only the points' positions are sent. Shuttle-only points
// are left out: nobody drives to them. Run it again when an aid station moves or a crew point is added.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALHALLA = 'https://valhalla1.openstreetmap.de';
const ctx = { console }; ctx.window = ctx; ctx.location = { search: '', hash: '' }; ctx.navigator = {}; ctx.document = { getElementById: () => null, querySelector: () => null, addEventListener() { } };
vm.createContext(ctx);
for (const f of ['data/config.js', 'data/course.js', 'data/courses.js', 'data/course-w3w.js', 'data/access-edits.js', 'js/engine.js', 'data/pacing.js', 'data/races.js', 'data/splits.js', 'data/runner-courses.js', 'js/races.js'])
  vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
const R = ctx.GPT_RACES, RX = ctx.GPTRaces;

// Every point a crew can drive to, once (the same place serves several races).
const pts = [];
for (const race of R.races) for (const id of race.stages) {
  const S = RX.prepare(R.stages[id], race.course);
  S.points.forEach((p, i) => {
    const ends = i === 0 || i === S.points.length - 1;
    if (p.crew !== 'yes' && !(ends && p.crew !== 'shuttle')) return;
    if (p.lat == null) return;
    const had = pts.find(q => Math.abs(q.lat - p.lat) < 0.002 && Math.abs(q.lon - p.lon) < 0.002);
    if (had) { if (!had.names.includes(p.name)) had.names.push(p.name); } else pts.push({ names: [p.name], lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) });
  });
}
console.log(pts.length + ' crew points:'); pts.forEach(p => console.log('  ' + p.names.join(' / ').padEnd(44), p.lat, p.lon));

const locs = pts.map(p => ({ lat: p.lat, lon: p.lon, radius: 400 }));
// The free server takes 100 pairs at a time: a few starting points per request, with a pause between.
const M = [], STEP = Math.max(1, Math.floor(100 / locs.length));
for (let i = 0; i < locs.length; i += STEP) {
  const res = await fetch(VALHALLA + '/sources_to_targets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'GPT100Safety crew drives' },
    body: JSON.stringify({ sources: locs.slice(i, i + STEP), targets: locs, costing: 'auto', units: 'kilometers' }) });
  if (!res.ok) { console.error('Valhalla said ' + res.status + ': ' + (await res.text()).slice(0, 300)); process.exit(1); }
  M.push(...(await res.json()).sources_to_targets);
  await new Promise(r => setTimeout(r, 1200));
}
const min = M.map(row => row.map(c => c.time == null ? null : Math.round(c.time / 60))), km = M.map(row => row.map(c => c.distance == null ? null : Math.round(c.distance * 10) / 10));
const holes = min.flat().filter(x => x == null).length;
if (holes) console.log('WARNING: ' + holes + ' pair(s) have no route. The app shows no drive time for those.');

const out = `// Drive times between the crew points (minutes and km by road), for "leave by" on the runner app's Crew tab.
// Made by tools/crew_drives.mjs on ${new Date().toISOString().slice(0, 10)} from OpenStreetMap roads (Valhalla). Do not edit by hand: run the tool again.
// A guide only: it knows nothing of race-day traffic, road closures or the walk in from the car park.
window.GPT_CREW_DRIVES = ${JSON.stringify({ made: new Date().toISOString().slice(0, 10), pts: pts.map(p => ({ names: p.names, lat: p.lat, lon: p.lon })), min, km })};
`;
writeFileSync(join(ROOT, 'data/crew-drives.js'), out);
console.log('wrote data/crew-drives.js');
pts.forEach((p, i) => console.log(p.names[0].padEnd(26) + min[i].map(x => String(x == null ? '-' : x).padStart(4)).join('')));
