# Crash tests

A set of scripts that drive the four apps in a real browser and try to break them, so a change can be checked before race week. They were written for the November 2026 crash test and found two faults that are now fixed (see the end).

## Run them

Once, on your computer (Node 18 or later):

```
npm install --no-save playwright
npx playwright install chromium
```

Then, from the repo:

```
node tools/crashtest/run.js quick    # about 10 minutes: bad input in each app, broken feeds, no signal
node tools/crashtest/run.js          # everything, about 40 minutes
```

`run.js` serves the apps from this checkout on `http://127.0.0.1:8765/` and a stand-in tracking and timing provider on `:8766`, runs each test in turn, and ends with the list of problems (the exit code is 1 if there are any). Nothing is sent to the real tracking or timing providers, the Worker or WhatsApp: requests to the Worker are blocked, links are stopped from leaving the page, and the demo field or the stand-in feeds supply the runners.

Each test can also be run by itself once the two servers are up (`python3 -m http.server 8765` in the repo, and `node tools/crashtest/feeds.js`):

| Script | What it does |
| --- | --- |
| `inputs.js staff` | The staff app on a laptop and a phone: about 60 searches in Find (km, coordinates, what3words, bibs, rubbish, script injection, very long text), every tab, and links such as `#bib=`, `#ll=` and `#km=` with good and bad values. |
| `inputs.js map` | The map page: links, taps across the map, the Runners panel's bib search, every layer on and off. |
| `inputs.js field` | The field app: the km box, the note, Where am I?, every race and stage with target times, the Runners sheet. |
| `inputs.js runner` | The runner app: both modes, every race and stage, every tab, ◎, target times, all five Help languages, the Track search, follow, splits, Show on map, shared links. |
| `inputs.js storage` | Every saved setting on the phone replaced with ten kinds of rubbish, then each app opened and every tab visited. |
| `feeds-gps-clock.js feeds` | Each app against a good feed, garbage, empty files, an error page, server errors, a hostile feed (script in names, bibs that clash, positions in Sydney and at 0,0, times in the future, wrong types), other list shapes, and 1,500 runners. |
| `feeds-gps-clock.js gps` | Location refused, far away, the other side of the world, poor accuracy, 2 km off the course, no location feature at all. |
| `feeds-gps-clock.js clock` | The phone's clock set months before, on race morning, mid race, at the last cut-off, the day after and a year on, with and without the demo. |
| `offline.js` | Opens one app with signal, cuts the network, then opens and uses every app. |
| `monkey.js` | Hundreds of random taps, typing, map moves, resizes, back and forward on each app with the demo race running, from fixed seeds so a failure can be repeated: `node tools/crashtest/monkey.js runner 350 2`. |
| `engine-compare.js <other checkout>` | After a change to `js/engine.js` that shouldn't change any answer: compares this checkout's engine with another's at every course point (about 26,000 checks). |

`feeds.js` is also handy by hand: open any app with `?gps=http://127.0.0.1:8766/weird/` (or `ok`, `garbage`, `empty`, `html`, `err500`, `mid` for 400 runners, `huge` for 1,500) to see how it behaves.

## What they can't check

The Medical, Control and Risk tabs behind the medical password (Control is covered through the demo), anything on a real iPhone or Android phone (home screen install, the compass, the share sheet), real GPS drift, and the live feeds themselves. Rehearse those by hand with `?demo=1` and on the phones the team will carry.

## November 2026 results

About 300 page loads, 500 scripted inputs and 4,200 random actions across the tests above, on a laptop and a phone size, in light and dark. Found and fixed:

- **Runner app, 6k, 5k and 2k:** ◎ (Where am I?) and Find my 3 words threw an error: the map said nothing and the Help tab stayed on "Finding you…" with no words or numbers. Those courses had no stored what3words lookup, in the app since 24 October 2026, so through race weekend (confirmed on the untouched build 102). They now use the stored words of the GPT100 or 14k where they share track, and always give the position as numbers. The Call 000 and Call race medical buttons were not affected.
- **Runner app, Track tab:** a damaged saved follow list (an object where a list was expected) stopped the whole tab from starting. Saved settings of the wrong shape are now ignored.

No script injection got through from any input, link, saved setting or feed, and no feed (broken, hostile or huge) stopped an app from working. The update from build 102 to 103 was rehearsed on one address: a phone on 102 moved to 103 on its first open with signal, and every app then worked with no signal.

The timing test that goes with them (a 400 runner field on a phone-speed processor) also caught a slow-down in a change before it shipped: worth a look at redraw times after any change to how runners are drawn.
