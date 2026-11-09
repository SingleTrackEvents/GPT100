// Expected splits fitted to how the field actually runs, for the runner and field apps (js/races.js).
// For each checkpoint, the share of a runner's finish time they have used when they get there is a straight line
// in their finish time: share = a + b × finish hours. Fitted to the GPT100 Miler 2026 results on the contingency
// course (Mt William to Jimmy Creek), from the race archive's chip times (tools/archive_race.mjs): 144 finishers,
// arrival reads ("In") at the aid stations, fitted on 10 Nov 2026. Points not listed (Copper Mine Track, the Ridgeline
// water point) are placed in proportion by race km between the fitted ones.
// Races without an entry here keep the blend of the first runner's time and the cut-off.
//
// Replaces the 2025 fit (Barefoot Sport export, 107 finishers, old route over the Major Mitchell Plateau), which put
// 2026 runners into Jimmy Creek 31 min late on average and forecast finishes from Halls Gap 1 h 49 min late.
// The 2026 times already include the contingency's extra km, so there's no new-km adjustment (flat, newKm).
window.GPT_SPLITS = {
  miler: {
    source: 'GPT100 Miler 2026 results, contingency course, 144 finishers (race archive chip times)',
    points: {
      'GAR Trailhead': { a: 0.0785, b: -0.0005 },
      'Mt Difficult Rd': { a: 0.1867, b: -0.00085 },
      'Halls Gap': { a: 0.2521, b: -0.00103 },
      'Rosea car park': { a: 0.3106, b: -0.00095 },
      'Borough Huts camp': { a: 0.372, b: -0.00076 },
      'Mt William car park': { a: 0.484, b: -0.00055 },
      'Jimmy Creek Camp': { a: 0.6045, b: -0.0004 },
      'Yarram Gap Rd': { a: 0.7076, b: -0.00057 },
      'Griffin Fireline': { a: 0.7875, b: -0.00087 },
      'Cassidys Gap Rd': { a: 0.8686, b: -0.00091 },
      'Bainggug car park': { a: 0.9472, b: -0.00051 },
      'Dunkeld': { a: 1, b: 0 }
    }
  }
};
