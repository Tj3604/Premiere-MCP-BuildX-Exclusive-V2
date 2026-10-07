/**
 * Hook bank (ranking + too-close warnings) and the YouTube Studio CSV import
 * that feeds it.
 */

import type { VideoEntry } from '../../library/index.js';
import { buildHookBank, checkHook, hookSimilarity, hookStatus } from '../../library/hooks.js';
import {
  applyStudioRow,
  matchRows,
  parseCsv,
  parseDuration,
  parseStudioDate,
  readStudioTable
} from '../../library/youtube.js';

function entry(slug: string, title: string, hookLine: string, perf: Partial<VideoEntry['performance']> = {}, extra: Partial<VideoEntry> = {}): VideoEntry {
  return {
    schemaVersion: 1,
    slug,
    title,
    hookLine,
    transcriptPath: `/t/${slug}.txt`,
    lengthSeconds: 30,
    cutCount: null,
    graphicsUsed: [],
    captionStyle: null,
    platformLinks: { youtube: null, instagram: null, tiktok: null, facebook: null },
    publishDate: null,
    performance: {
      views7d: null,
      views30d: null,
      avgViewDurationSeconds: null,
      retentionPercent: null,
      stayedToWatchPercent: null,
      measuredAt: null,
      ...perf
    },
    exportPath: `/e/${slug}.mp4`,
    addedAt: '2026-10-06T00:00:00Z',
    ...extra
  };
}

describe('hookSimilarity', () => {
  it('scores rewordings high and unrelated hooks low', () => {
    expect(hookSimilarity('Garages are exempt from the GFA.', 'Garages are exempt from GFA').score).toBeGreaterThan(0.8);
    expect(hookSimilarity('Garages are exempt from the GFA.', 'This island seats seven.').score).toBeLessThan(0.3);
  });

  it('ignores spoken filler', () => {
    expect(hookSimilarity('So, um, you know, septic decides everything.', 'Septic decides everything.').score).toBe(1);
  });

  it('flags hooks that open with the same four words', () => {
    expect(hookSimilarity('Any contractor that tells you it is easy', 'Any contractor that tells you never has problems').sameOpening).toBe(true);
    expect(hookSimilarity('Short hook', 'Short hook').sameOpening).toBe(false);
  });
});

describe('hookStatus', () => {
  it('is posted with a publish date or a link, queued otherwise', () => {
    expect(hookStatus(entry('a', 'A', 'x'))).toBe('queued');
    expect(hookStatus(entry('b', 'B', 'x', {}, { publishDate: '2026-10-01' }))).toBe('posted');
    expect(
      hookStatus(entry('c', 'C', 'x', {}, { platformLinks: { youtube: 'https://www.youtube.com/watch?v=abc', instagram: null, tiktok: null, facebook: null } }))
    ).toBe('posted');
  });
});

describe('buildHookBank', () => {
  const entries = [
    entry('looped', 'Looped', 'Garages are exempt.', { views30d: 4000, retentionPercent: 112.5, stayedToWatchPercent: 51 }),
    entry('solid', 'Solid', 'Septic decides everything.', { views30d: 900, retentionPercent: 74, stayedToWatchPercent: 44 }),
    entry('tiny', 'Tiny', 'Two views only.', { views30d: 7, retentionPercent: 2182.9, stayedToWatchPercent: 100 }),
    entry('none', 'None', 'Not measured yet.')
  ];

  it('ranks by the metric, keeps tiny-sample rates out of the ranking', () => {
    const bank = buildHookBank(entries, 'retention', 150, 10);
    expect(bank.ranked.map((r) => r.slug)).toEqual(['looped', 'solid']);
    expect(bank.ranked[0]!.rank).toBe(1);
    expect(bank.belowViewFloor.map((r) => r.slug)).toEqual(['tiny']);
    expect(bank.unmeasured.map((r) => r.slug)).toEqual(['none']);
  });

  it('applies no floor when ranking by views', () => {
    const bank = buildHookBank(entries, 'views30d', 150, 10);
    expect(bank.ranked.map((r) => r.slug)).toEqual(['looped', 'solid', 'tiny']);
    expect(bank.belowViewFloor).toEqual([]);
  });
});

describe('checkHook', () => {
  const entries = [
    entry('posted', 'Posted', 'Any contractor that tells you you never have problems is full of baloney.', {}, { publishDate: '2026-09-20' }),
    entry('queued', 'Queued', 'Septic and the water table decide everything.'),
    entry('other', 'Other', 'This island seats seven.')
  ];

  it('warns, naming the posted hook it collides with', () => {
    const result = checkHook('Any contractor who says they never have problems is full of baloney.', entries, 0.6, 5);
    expect(result.tooClose).toBe(true);
    expect(result.closest[0]!.slug).toBe('posted');
    expect(result.warning).toMatch(/posted hook/);
  });

  it('catches a queued near-duplicate too', () => {
    const result = checkHook('The septic and water table decide everything', entries, 0.6, 5);
    expect(result.tooClose).toBe(true);
    expect(result.closest[0]!.status).toBe('queued');
  });

  it('passes a fresh hook with no warning', () => {
    const result = checkHook('We dug a 175 foot trench for the new service.', entries, 0.6, 2);
    expect(result.tooClose).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.closest).toHaveLength(2);
  });
});

describe('YouTube Studio CSV', () => {
  const csv = [
    'Content,Video title,Video publish time,Duration,Views,Watch time (hours),Average view duration,Average percentage viewed (%),Stayed to watch (%)',
    'Total,,,,5500,40.1,0:00:26,,',
    'abcDEF12345,"Garages, Porches And The GFA #adu",Sep 22 2026,41,4000,30.2,0:00:46,112.5,51.2',
    'zzzYYY98765,Septic Decides Everything,"Sep 2, 2026",30,900,6.1,0:00:22,74,44',
    'qqqWWW11111,Totally Unrelated Video,"Sep 3, 2026",20,600,2,0:00:10,50,30'
  ].join('\n');

  it('parses quoted fields, dates and durations', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', '2', '3']
    ]);
    expect(parseStudioDate('Sep 2, 2026')).toBe('2026-09-02');
    expect(parseStudioDate('2026-09-22')).toBe('2026-09-22');
    expect(parseDuration('0:00:46')).toBe(46);
    expect(parseDuration('1:05')).toBe(65);
    expect(parseDuration('—')).toBeNull();
  });

  it('finds columns by header and skips the Total row', () => {
    const { rows, columns } = readStudioTable(csv);
    expect(rows).toHaveLength(3);
    expect(columns.stayedToWatch).toBe('Stayed to watch (%)');
    expect(rows[0]).toMatchObject({ videoId: 'abcDEF12345', views: 4000, avgViewDurationSeconds: 46, retentionPercent: 112.5, stayedToWatchPercent: 51.2 });
    expect(rows[1]!.publishDate).toBe('2026-09-02');
  });

  it('matches by stored video ID first, then by title, and refuses to guess', () => {
    const { rows } = readStudioTable(csv);
    const library = [
      entry('r12-garages', 'R12_Garages Are Exempt', 'You cant put a garage on an ADU.', {}, {
        platformLinks: { youtube: 'https://www.youtube.com/watch?v=abcDEF12345', instagram: null, tiktok: null, facebook: null }
      }),
      entry('s7-06-septic', 'S7 06 - Septic And The Water Table Decide Everything', 'Septic first.'),
      entry('kitchen', 'Short 04 - An Island For Seven', 'This island seats seven.')
    ];
    const [garages, septic, unrelated] = matchRows(rows, library);
    expect(garages!.how).toBe('video-id');
    expect(garages!.entry!.slug).toBe('r12-garages');
    expect(septic!.how).toBe('title');
    expect(septic!.entry!.slug).toBe('s7-06-septic');
    expect(unrelated!.entry).toBeNull();
    expect(unrelated!.candidates.length).toBeGreaterThan(0);
  });

  it('writes the window, rates, date and link without touching the rest', () => {
    const { rows } = readStudioTable(csv);
    const before = entry('s7-06-septic', 'S7 06 - Septic', 'Septic first.', { views7d: 120 });
    const after = applyStudioRow(before, rows[1]!, '30d', '2026-10-06');
    expect(after.performance).toEqual({
      views7d: 120,
      views30d: 900,
      avgViewDurationSeconds: 22,
      retentionPercent: 74,
      stayedToWatchPercent: 44,
      measuredAt: '2026-10-06'
    });
    expect(after.publishDate).toBe('2026-09-02');
    expect(after.platformLinks.youtube).toBe('https://www.youtube.com/watch?v=zzzYYY98765');
    expect(before.performance.views30d).toBeNull();
    expect(after.hookLine).toBe(before.hookLine);
  });
});
