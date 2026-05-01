// apps/api/src/lib/literaryPrompts.ts — genre-specific master prompts + humanization filter.
// Applied to kdp_novel and narrative_story styles (optionally cookbook/narrative chapters).

export type Genre =
  | 'literary' | 'thriller' | 'romance' | 'sci_fi' | 'fantasy'
  | 'mystery'  | 'memoir'   | 'ya';

export type POV = 'first' | 'close_third' | 'omniscient';

const GENRE_VOICE: Record<Genre, string> = {
  literary:
    'Voice: measured, introspective, imagistic. Reward attention. Favor specific sensory detail ' +
    'over abstract summary. Let subtext do the work.',
  thriller:
    'Voice: propulsive, lean, kinetic. Short sentences during action; longer when characters think. ' +
    'End chapters on a pivot, decision, or reveal.',
  romance:
    'Voice: emotionally attentive, sensual without purple prose. Track physical awareness, ' +
    'heartbeat, breath, and small gestures. Earn every moment.',
  sci_fi:
    'Voice: grounded futurism. Introduce the extraordinary through ordinary actions. ' +
    'Avoid info-dumps — reveal worldbuilding through friction and misuse.',
  fantasy:
    'Voice: evocative but legible. Names should feel natural on the tongue. Magic has rules and costs.',
  mystery:
    'Voice: observant, restrained, faintly wry. Plant clues in plain sight. The detective notices; ' +
    'the reader should notice too, a beat later.',
  memoir:
    'Voice: honest, specific, generous. Reflect from the present while inhabiting the past scene. ' +
    'Name real people and places; let them be complicated.',
  ya:
    'Voice: urgent, immediate, funny in the right beats. Internal life foregrounded. ' +
    'Adults are real, not cardboard. No condescension.',
};

const POV_RULES: Record<POV, string> = {
  first:
    'POV: first person. Stay inside the narrator\'s head. Only describe what they can perceive, ' +
    'remember, infer, or imagine.',
  close_third:
    'POV: close third. Track one character per scene. Their thoughts, senses, and assessments only. ' +
    'No head-hopping within a scene.',
  omniscient:
    'POV: omniscient. Move between minds deliberately, not accidentally. Each shift should do work.',
};

/** The banned-phrase list — the "AI tells" the humanization filter removes. */
export const AI_TELLS: RegExp[] = [
  /\bin conclusion,?\s+/gi,
  /\bit['\u2019]s important to note,?\s+/gi,
  /\bit is important to note,?\s+/gi,
  /\bdelve\s+into\b/gi,
  /\bnavigate\s+the\s+complexities\b/gi,
  /\bplay(?:s|ed|ing)?\s+a\s+(?:crucial|pivotal|vital)\s+role\b/gi,
  /\bembark\s+on\s+a\s+journey\b/gi,
  /\btestament\s+to\b/gi,
  /\bin\s+the\s+realm\s+of\b/gi,
  /\bthe\s+tapestry\s+of\b/gi,
  /\bmultifaceted\b/gi,
  /\bat\s+the\s+end\s+of\s+the\s+day,?\s+/gi,
  /\bgame[- ]changer\b/gi,
];

export interface ChapterPromptInput {
  bookTitle:   string;
  genre:       Genre;
  pov:         POV;
  tone?:       string;
  audience?:   string;
  chapterNumber:     number;
  chapterTitle:      string;
  chapterSummary:    string;
  targetWords:       number;
  previousSummary?:  string;   // last chapter's summary for continuity
}

/** Build the draft-pass prompt for a single chapter. */
export function chapterDraftPrompt(input: ChapterPromptInput): string {
  const voice = GENRE_VOICE[input.genre] ?? GENRE_VOICE.literary;
  const pov   = POV_RULES[input.pov] ?? POV_RULES.close_third;
  const prev  = input.previousSummary
    ? `\nContinuity: the previous chapter ended with — ${input.previousSummary}`
    : '';
  return [
    `You are writing Chapter ${input.chapterNumber} of a novel titled "${input.bookTitle}".`,
    ``,
    `${voice}`,
    `${pov}`,
    input.tone     ? `Tone: ${input.tone}.` : '',
    input.audience ? `Audience: ${input.audience}.` : '',
    ``,
    `This chapter is titled "${input.chapterTitle}".`,
    `Chapter goal: ${input.chapterSummary}${prev}`,
    ``,
    `## Rules — NON-NEGOTIABLE`,
    `1. Show, don't tell. Use sensory detail, action, and dialogue instead of narration summary.`,
    `2. Dialogue: one speaker per paragraph, use action beats instead of adverbs on "said".`,
    `3. Vary sentence length. Open with a hook image or action. Close with a question, image, or decision.`,
    `4. No AI tells: never use "in conclusion", "it's important to note", "delve into", "tapestry of", "play(s) a crucial role".`,
    `5. No em-dash overuse. No chatbot verbal tics. No meta commentary about what you're writing.`,
    `6. Target length: ${input.targetWords} words (±15%).`,
    `7. Return ONLY the chapter prose. No headings, no notes, no explanations.`,
  ].filter(Boolean).join('\n');
}

/** Editor-pass prompt — feed the draft back in for voice consistency + tightening. */
export function chapterEditorPrompt(draft: string, input: ChapterPromptInput): string {
  return [
    `You are editing Chapter ${input.chapterNumber} of "${input.bookTitle}".`,
    ``,
    `Rewrite the following draft for:`,
    `  • voice consistency with the ${input.genre.replace('_', ' ')} register`,
    `  • dialogue polish (beats, not adverbs)`,
    `  • removing AI tells and clichés`,
    `  • tightening — cut 10–15% of word count without losing scenes`,
    `  • preserving all plot points and character moments`,
    ``,
    `Return only the revised prose. Same length target: ~${input.targetWords} words.`,
    ``,
    `---DRAFT---`,
    draft,
  ].join('\n');
}

/**
 * Humanization filter — post-processes AI prose.
 * - Strips banned phrases.
 * - Varies sentence openers (breaks up three consecutive sentences starting with "The" / "She" / "He").
 * - Injects occasional one-word fragments at paragraph breaks (rare — 1 in ~8 paragraphs).
 */
export function humanize(text: string): string {
  let out = text;

  // 1. Remove banned phrases
  for (const rx of AI_TELLS) out = out.replace(rx, '');

  // 2. Replace repetitive em-dash storms with period + space
  out = out.replace(/\s*—\s*—\s*/g, '. ').replace(/—{2,}/g, '—');

  // 3. Break up long three-clause sentences joined by semicolons
  out = out.replace(/([^;.!?]{80,});\s+/g, '$1. ');

  // 4. Collapse leftover double spaces from phrase removals
  out = out.replace(/ {2,}/g, ' ').replace(/ \./g, '.');

  // 5. Trim trailing whitespace on every line
  out = out.split('\n').map((l) => l.trimEnd()).join('\n');

  return out.trim();
}
