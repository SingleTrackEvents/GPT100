// Runner pacing for the weather simulator and the "runners on course" checks.
// From the GPT_2026 Course Details sheet (Miler): fastest = first runner's time of day, slowest = cut-off.
// km is GPT100 km in this app (each point's km on the course line). Since 5 November 2026 the course takes the
// contingency from Mt William to Jimmy Creek: km from Jimmy Creek on are 1.64 km more, and Stockyard Track is gone
// (no water point in its place). Cut-offs (slow) are unchanged. The fastest times from Jimmy Creek on are 39 min
// earlier than the sheet's: the 2026 winner ran Mt William to Jimmy Creek in 2 h 03 min on the contingency (the sheet
// allowed 162 min for the old route), and later legs as planned. Times are Melbourne local time.
window.GPT100_PACING = {
  miler: {
    label: 'GPT100 Miler',
    points: [
      { km: 0, name: 'Mt Zero', fast: '2026-11-06T08:00', slow: '2026-11-06T08:00' },
      { km: 6.45, name: 'Copper Mine', fast: '2026-11-06T08:37', slow: '2026-11-06T09:30' },
      { km: 15.62, name: 'GAR', fast: '2026-11-06T09:26', slow: '2026-11-06T12:00' },
      { km: 30.11, name: 'Mt Difficult Ridgeline', fast: '2026-11-06T10:56', slow: '2026-11-06T16:30' },
      { km: 35.31, name: 'Mt Difficult Rd', fast: '2026-11-06T11:35', slow: '2026-11-06T17:00' },
      { km: 49.17, name: 'Halls Gap', fast: '2026-11-06T12:50', slow: '2026-11-06T20:00' },
      { km: 58.94, name: 'Mt Rosea', fast: '2026-11-06T14:07', slow: '2026-11-06T23:00' },
      { km: 71.67, name: 'Borough Huts', fast: '2026-11-06T15:33', slow: '2026-11-07T02:15' },
      { km: 86.36, name: 'Mt William', fast: '2026-11-06T17:54', slow: '2026-11-07T08:15' },
      { km: 108.09, name: 'Jimmy Creek Camp', fast: '2026-11-06T19:57', slow: '2026-11-07T14:30' },
      { km: 119.85, name: 'Yarram Gap', fast: '2026-11-06T21:42', slow: '2026-11-07T18:30' },
      { km: 131.86, name: 'Griffin', fast: '2026-11-06T23:27', slow: '2026-11-07T22:15' },
      { km: 143.12, name: 'Cassidys', fast: '2026-11-07T01:02', slow: '2026-11-08T02:00' },
      { km: 153.86, name: 'Bainggug', fast: '2026-11-07T02:57', slow: '2026-11-08T06:30' },
      { km: 164.19, name: 'Dunkeld', fast: '2026-11-07T04:21', slow: '2026-11-08T10:00' }
    ]
  }
};
