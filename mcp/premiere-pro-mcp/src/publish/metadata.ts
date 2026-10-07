/**
 * Upload metadata: the platform rules, and a strict check on text before it is
 * saved. The text itself is written by the agent in-session from the brief —
 * this server has no model of its own — so everything here is deterministic.
 *
 * Rules: platform limits; 3–5 hashtags; YouTube Shorts carries #shorts; no
 * "drywall" (BuildX walls are thin coat plaster); no figure that is not in the
 * transcript (verified-facts.md governs numbers); no call to action — BuildX never
 * authors one (brand.md, CTA policy). Measured hook findings (hook-performance)
 * are warnings: "BuildX" at the start of a title and "Meet The <Model>" lose.
 */

export interface PlatformText {
  title?: string;
  /** YouTube description, or the Instagram / TikTok caption. */
  text: string;
  hashtags: string[];
}

export interface UploadMetadata {
  youtube: PlatformText & { title: string };
  instagram: PlatformText;
  tiktok: PlatformText;
}

export const LIMITS = {
  youtube: { title: 100, text: 5000 },
  instagram: { text: 2200 },
  tiktok: { text: 2200 }
} as const;

export const HASHTAGS = { min: 3, max: 5 };

const CTA = /\b(link in (my |our )?bio|dm (us|me)|call (us|me|today|now)|text (us|me)|contact us|reach out|book (a|your|now)|schedule (a|your)|sign up|click|subscribe|follow (us|me|for)|visit (us|our|buildx)|learn more|get started|free (consultation|quote|estimate)|don'?t miss|act now)\b/i;

export interface Check {
  errors: string[];
  warnings: string[];
}

/** The full posted text: body plus the hashtags on their own line. */
export function composed(p: PlatformText): string {
  return p.hashtags.length ? `${p.text.trim()}\n\n${p.hashtags.join(' ')}` : p.text.trim();
}

/** Every number written in text: "$40,000" -> 40000, "1.5" -> 1.5, "200" -> 200. */
export function figures(text: string): number[] {
  return [...text.matchAll(/\$?\d[\d,]*(\.\d+)?/g)].map((m) => Number(m[0].replace(/[$,]/g, ''))).filter((n) => Number.isFinite(n));
}

export function checkMetadata(meta: UploadMetadata, transcript: string): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const said = new Set(figures(transcript));

  const platforms: Array<[keyof UploadMetadata, PlatformText]> = [
    ['youtube', meta.youtube],
    ['instagram', meta.instagram],
    ['tiktok', meta.tiktok]
  ];
  for (const [name, p] of platforms) {
    if (!p || typeof p.text !== 'string') {
      errors.push(`${name}: missing text`);
      continue;
    }
    const full = composed(p);
    const limit = LIMITS[name].text;
    if (full.length > limit) errors.push(`${name}: ${full.length} characters with hashtags, over the ${limit} limit`);
    if (!p.text.trim()) errors.push(`${name}: empty text`);

    const tags = p.hashtags ?? [];
    if (tags.length < HASHTAGS.min || tags.length > HASHTAGS.max) errors.push(`${name}: ${tags.length} hashtags — use ${HASHTAGS.min}–${HASHTAGS.max}`);
    for (const t of tags) if (!/^#[A-Za-z0-9_]+$/.test(t)) errors.push(`${name}: "${t}" is not a hashtag (# then letters, numbers or _)`);
    if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) errors.push(`${name}: repeated hashtag`);

    const all = [p.title ?? '', p.text, ...tags].join(' ');
    if (/drywall/i.test(all)) errors.push(`${name}: says "drywall" — BuildX walls are thin coat plaster`);
    const cta = CTA.exec(all);
    if (cta) errors.push(`${name}: "${cta[0]}" reads as a call to action — BuildX never authors one (brand.md)`);
    for (const n of figures([p.title ?? '', p.text].join(' '))) {
      if (!said.has(n)) errors.push(`${name}: the figure ${n} is not in the transcript — check verified-facts.md and use what was said`);
    }
  }

  const title = meta.youtube?.title ?? '';
  if (!title.trim()) errors.push('youtube: empty title');
  if (title.length > LIMITS.youtube.title) errors.push(`youtube: title is ${title.length} characters, over ${LIMITS.youtube.title}`);
  if (!meta.youtube?.hashtags?.some((t) => t.toLowerCase() === '#shorts')) errors.push('youtube: add #shorts to the hashtags');
  if (/^\s*build ?x\b/i.test(title)) warnings.push('youtube: title opens with "BuildX" — measured to lose (hook-performance)');
  if (/^\s*meet the\b/i.test(title)) warnings.push('youtube: "Meet The …" titles are retired (hook-performance)');
  if (!/\d/.test(title)) warnings.push('youtube: no number in the title — a specific number measured best');
  return { errors, warnings };
}

export function metadataMarkdown(name: string, meta: UploadMetadata, check: Check): string {
  const block = (label: string, p: PlatformText) =>
    [`## ${label}`, '', ...(p.title ? ['**Title**', '', '```', p.title, '```', ''] : []), `**${p.title ? 'Description' : 'Caption'}**`, '', '```', composed(p), '```', ''].join('\n');
  return [
    `> Upload metadata for ${name}: copy-paste text per platform. Checked against the platform limits and the BuildX rules before saving.`,
    '',
    `# Upload — ${name}`,
    '',
    ...(check.warnings.length ? ['Notes:', ...check.warnings.map((w) => `- ${w}`), ''] : []),
    block('YouTube Shorts', meta.youtube),
    block('Instagram Reels', meta.instagram),
    block('TikTok', meta.tiktok)
  ].join('\n');
}
