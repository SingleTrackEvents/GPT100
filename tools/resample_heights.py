#!/usr/bin/env python3
"""Re-samples the heights along a stretch of the GPT100 course from a terrain model: rewrites data/course.js.

Usage: python3 tools/resample_heights.py 86.363 108.085             the points after km 86.363, up to km 108.085
       python3 tools/resample_heights.py 86.363 108.085 --dry-run   show the difference and write nothing

For a stretch whose GPX heights are stepped (flat for many points, then a jump: node tools/check_heights.mjs finds
them). The Miler contingency from Mt William Carpark to Jimmy Creek Camp was one: most of its GPX sat flat for up to
0.95 km and then jumped by up to 145 m. The elevation profile, the steepness colours, the climb figures and the climb
part of the walk-in and carry-out times (climbPenalty in data/config.js) all come from these heights.

Only the height of each point on the stretch changes (the fourth value of its route row). Every lat, lon and km, the
access points and the rest of the file stay as they are, and the script checks that before it writes. Two figures
worked out from the heights follow them: total_ascent_m in data/course.js and, when the stretch is the one in
data/contingency.js (leave km to rejoin km), main_ascent_m there.

Heights are the ground height at each point from the two terrain services tools/import_helipads.py uses, in the other
order: OpenTopoData's SRTM 30 m first, read between its cells, then the Open-Meteo elevation API (Copernicus 90 m).
The course has a point every 25 to 45 m, so the 30 m model is the closer fit, and it is the one checked against the
course: on the 142 km with GPS heights it sits 0.6 m above them on average (9 in 10 points within 9 m) and gives 4%
more climb with a point every 43 m, as on that stretch (10 November 2026). One service supplies the whole stretch,
never a mix, as each has its own offset.

Tie-in: the point before the stretch and the point after it keep their GPX heights. Where the terrain model differs
from one of them by 5 m or more (Mt William Carpark: 950 m against the GPX's 935 m), the difference is taken off the
stretch's heights beside it, all of it at the join and none 300 m along, so the profile has no false step there.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
COURSE = os.path.join(ROOT, 'data', 'course.js')
CONTINGENCY = os.path.join(ROOT, 'data', 'contingency.js')

BATCH = 100       # positions per request (the limit of both services)
PAUSE = 1.1       # seconds between requests (OpenTopoData allows one a second)
TIE_MIN = 5.0     # tie in an end of the stretch when the terrain model is this many metres off the GPX there
TIE_KM = 0.3      # ...easing the difference out over this distance
# Terrain heights, as in tools/import_helipads.py. Each returns one height per position, in order.
DEMS = [
    ('OpenTopoData SRTM 30 m', lambda pts: 'https://api.opentopodata.org/v1/srtm30m?interpolation=bilinear&locations=' + '|'.join(f'{p[0]},{p[1]}' for p in pts),
     lambda j: [r['elevation'] for r in j['results']]),
    ('Open-Meteo elevation API (Copernicus 90 m)', lambda pts: 'https://api.open-meteo.com/v1/elevation?' + urllib.parse.urlencode(
        {'latitude': ','.join(str(p[0]) for p in pts), 'longitude': ','.join(str(p[1]) for p in pts)}), lambda j: j['elevation']),
]
ROW = re.compile(r'\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]')


def dem_heights(pts):
    """Ground heights (m) for [(lat, lon)] from one terrain service, and its name, or (None, None) when neither answers."""
    for name, url, read in DEMS:
        out = []
        for k in range(0, len(pts), BATCH):
            part, got = pts[k:k + BATCH], None
            for attempt in range(3):
                if k or attempt:
                    time.sleep(PAUSE * (attempt + 1))
                try:
                    with urllib.request.urlopen(url(part), timeout=60) as r:
                        h = read(json.load(r))
                    if len(h) == len(part) and all(x is not None for x in h):
                        got = h
                        break
                    print(name + ': incomplete answer', file=sys.stderr)
                except Exception as e:
                    print(name + ': ' + str(e), file=sys.stderr)
            if got is None:
                break
            out += got
        if len(out) == len(pts):
            return out, name
    return None, None


def num(x):
    """A height as the data files write it: one decimal place at most, no trailing zero."""
    s = f'{x:.1f}'
    return s[:-2] if s.endswith('.0') else s


def figures(h, km):
    """Climb, descent, share of points with the height of the point before, and the biggest single step."""
    up = down = flat = big = 0
    for a, b in zip(h, h[1:]):
        d = b - a
        up += max(0, d)
        down += max(0, -d)
        flat += d == 0
        big = max(big, abs(d))
    return f'up {up:.0f} m, down {down:.0f} m over {km:.1f} km; {100 * flat / max(1, len(h) - 1):.0f}% of points at the height of the one before; biggest single step {big:.0f} m'


def main():
    args = [a for a in sys.argv[1:] if a != '--dry-run']
    dry = '--dry-run' in sys.argv[1:]
    try:
        k0, k1 = float(args[0]), float(args[1])
        assert len(args) == 2 and k1 > k0
    except (IndexError, ValueError, AssertionError):
        sys.exit(__doc__)

    src = open(COURSE, encoding='utf-8').read()
    m = re.search(r'window\.GPT100_DATA = (\{.*\});', src, re.S)
    data = json.loads(m.group(1))
    route = data['route']
    idx = [i for i, p in enumerate(route) if k0 + 1e-6 < p[2] <= k1 + 1e-6]
    if not idx:
        sys.exit(f'No course points after km {k0} up to km {k1}.')
    first, last = idx[0], idx[-1]
    lo, hi = max(0, first - 1), min(len(route) - 1, last + 1)   # with the point either side, for the tie-in

    heights, source = dem_heights([(p[0], p[1]) for p in route[lo:hi + 1]])
    if not heights:
        sys.exit('No terrain service answered (needs signal). Nothing changed.')
    dem = dict(zip(range(lo, hi + 1), heights))

    # The difference to take off beside each end, where a point outside the stretch keeps its GPX height.
    ties = []
    for end, into in ((lo, first), (hi, last)):
        if end != into and abs(route[end][3] - dem[end]) >= TIE_MIN:
            ties.append((route[end][2], route[end][3] - dem[end]))
            print(f'Tie-in at km {route[end][2]}: the terrain model has {dem[end]:.0f} m, the course {route[end][3]} m. '
                  f'{abs(route[end][3] - dem[end]):.1f} m eased out over the {TIE_KM * 1000:.0f} m beside it.')
    new = {}
    for i in idx:
        h = dem[i]
        for km, off in ties:
            h += off * max(0.0, 1 - abs(route[i][2] - km) / TIE_KM)
        new[i] = float(num(h))

    # Rewrite only the fourth value of those rows, leaving every other character of the file alone.
    at = src.index('"route":[', m.start(1)) + len('"route":[')
    out, pos, n = [src[:at]], at, 0
    while src[pos] == '[':
        r = ROW.match(src, pos)
        if not r:
            sys.exit(f'Route row {n} is not [lat, lon, km, height]. Nothing changed.')
        out.append(f'[{r.group(1)},{r.group(2)},{r.group(3)},{num(new[n])}]' if n in new else r.group(0))
        pos, n = r.end(), n + 1
        if src[pos] == ',':
            out.append(',')
            pos += 1
    if n != len(route):
        sys.exit('Route rows miscounted. Nothing changed.')
    text = ''.join(out) + src[pos:]
    after = [new.get(i, p[3]) for i, p in enumerate(route)]
    ascent = round(sum(max(0, b - a) for a, b in zip(after, after[1:])))
    text, subs = re.subn(r'("total_ascent_m":)\d+', lambda r: r.group(1) + str(ascent), text, count=1)
    # Check: the same file but for those heights and the total.
    check = json.loads(re.search(r'window\.GPT100_DATA = (\{.*\});', text, re.S).group(1))
    want = json.loads(m.group(1))
    want['total_ascent_m'] = ascent
    for i, h in new.items():
        want['route'][i][3] = h
    if subs != 1 or check != want or any(a[:3] != b[:3] for a, b in zip(check['route'], route)):
        sys.exit('The rewritten file differs in more than the heights. Nothing changed.')

    span = range(lo, last + 1)   # from the point before, so the join counts
    km = route[last][2] - route[span[0]][2]
    print(f'{len(idx)} points from km {route[first][2]} to km {route[last][2]}, heights from {source}.')
    print('  Before: ' + figures([route[i][3] for i in span], km))
    print('  After:  ' + figures([after[i] for i in span], km))
    print(f"  Course climb: {data['total_ascent_m']} m before, {ascent} m after.")
    if dry:
        print('Dry run: nothing written.')
        return
    open(COURSE, 'w', encoding='utf-8').write(text)
    print('Written to data/course.js.')

    # The climb of the same stretch, as data/contingency.js records it next to the other way's.
    try:
        c = open(CONTINGENCY, encoding='utf-8').read()
        x = json.loads(re.search(r'window\.GPT100_CONTINGENCY = (\{.*\});', c, re.S).group(1))
        if abs(x['leave']['km'] - k0) < 0.001 and abs(x['rejoin']['km'] - k1) < 0.001:
            up = round(sum(max(0, after[i] - after[i - 1]) for i in idx))
            c2, done = re.subn(r'("main_ascent_m":)\d+', lambda r: r.group(1) + str(up), c, count=1)
            if done:
                open(CONTINGENCY, 'w', encoding='utf-8').write(c2)
                print(f"main_ascent_m in data/contingency.js: {x['main_ascent_m']} m before, {up} m after.")
    except (OSError, AttributeError, KeyError, ValueError):
        pass
    print('Now run node tools/check_heights.mjs, check a few km in Find, and node tools/bump_version.mjs.')


if __name__ == '__main__':
    main()
