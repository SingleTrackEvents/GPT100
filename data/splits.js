// Expected splits fitted to how the field actually runs, for the runner and field apps (js/races.js).
// For each checkpoint, the share of a runner's finish time they have used when they get there is a straight line
// in their finish time: share = a + b × finish hours. Fitted to the GPT100 Miler 2026 results on the contingency
// course (Mt William to Jimmy Creek), from the race archive's chip times (tools/archive_race.mjs): 144 finishers,
// arrival reads ("In") at the aid stations, fitted on 10 Nov 2026. Points not listed (Copper Mine Track, the Ridgeline
// water point) are placed in proportion by race km between the fitted ones.
// The stages are fitted the same way: Stage 1 (and the 50k) and Stage 4 (and the 33k) from chip times, Stages 2 and 3
// from the stage race's GPS tracks (the timing list held Stage 1 only), timed where each track first passes the point.
// Checked on the Miler, GPS times were a median 0.2 min from the chip reads (98% within 5 min).
// gk is each point's km on the GPT100 course, so the staff apps' tracker (js/tracking.js) can use these fits for when a
// runner is due at their next timing point, without the runner app's race model.
// Races without an entry here keep the blend of the first runner's time and the cut-off.
//
// Replaces the 2025 fit (Barefoot Sport export, 107 finishers, old route over the Major Mitchell Plateau), which put
// 2026 runners into Jimmy Creek 31 min late on average and forecast finishes from Halls Gap 1 h 49 min late.
// The 2026 times already include the contingency's extra km, so there's no new-km adjustment (flat, newKm).
window.GPT_SPLITS = {
  miler: {
    source: 'GPT100 Miler 2026 results, contingency course, 144 finishers (race archive chip times)',
    points: {
      'GAR Trailhead': { a: 0.0785, b: -0.0005, gk: 15.62 },
      'Mt Difficult Rd': { a: 0.1867, b: -0.00085, gk: 35.30 },
      'Halls Gap': { a: 0.2521, b: -0.00103, gk: 49.17 },
      'Rosea car park': { a: 0.3106, b: -0.00095, gk: 58.94 },
      'Borough Huts camp': { a: 0.372, b: -0.00076, gk: 71.67 },
      'Mt William car park': { a: 0.484, b: -0.00055, gk: 86.36 },
      'Jimmy Creek Camp': { a: 0.6045, b: -0.0004, gk: 108.08 },
      'Yarram Gap Rd': { a: 0.7076, b: -0.00057, gk: 119.85 },
      'Griffin Fireline': { a: 0.7875, b: -0.00087, gk: 131.85 },
      'Cassidys Gap Rd': { a: 0.8686, b: -0.00091, gk: 143.12 },
      'Bainggug car park': { a: 0.9472, b: -0.00051, gk: 153.86 },
      'Dunkeld': { a: 1, b: 0, gk: 164.19 }
    }
  },
  s1: {
    source: 'GPT50K and Stage 1 2026, chip times, 288 finishers (also used by the 50k)',
    points: {
      'GAR Trailhead': { a: 0.3091, b: -0.0043, gk: 15.62 },
      'Mt Difficult Rd': { a: 0.7498, b: -0.00281, gk: 35.30 },
      'Halls Gap': { a: 1, b: 0, gk: 49.17 }
    }
  },
  s2: {
    source: 'Stage 2 2026, GPS tracks, 71 finishers',
    points: {
      'Rosea car park': { a: 0.2726, b: -0.0044, gk: 58.94 },
      'Borough Huts camp': { a: 0.5556, b: -0.00444, gk: 71.67 },
      'Mt William car park': { a: 1, b: 0, gk: 86.36 }
    }
  },
  s3: {
    source: 'Stage 3 2026 on the contingency, GPS tracks, 68 finishers',
    points: {
      'Jimmy Creek Rd': { a: 0.4359, b: -0.00337, gk: 108.08 },
      'Yarram Gap Rd': { a: 0.7324, b: 0.00011, gk: 119.85 },
      'Griffin Fireline': { a: 1, b: 0, gk: 131.85 }
    }
  },
  s4: {
    source: 'Stage 4 and the 33k 2026, 33k chip times and stage race GPS tracks, 193 finishers (also used by the 33k)',
    points: {
      'Cassidys Gap Rd': { a: 0.3418, b: -0.00785, gk: 143.12 },
      'Bainggug car park': { a: 0.7104, b: -0.00459, gk: 153.86 },
      'Dunkeld': { a: 1, b: 0, gk: 164.19 }
    }
  }
};
