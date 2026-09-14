import type { ThumbnailGenerationSettings, ThumbnailTextSettings } from './types';

const LAYOUT_DIRECTIONS = {
  auto: 'Analyze the references and put the headline in the cleanest dark negative space: left, right or lower center.',
  'text-left': 'Prefer the left side for the headline and the right side for the main character, unless that would cover a face or focal object.',
  'text-right': 'Prefer the right side for the headline and the left side for the main character, unless that would cover a face or focal object.',
  center: 'Prefer a compact headline across the lower safe area while keeping the face, hands and focal magic unobstructed.',
} satisfies Record<ThumbnailGenerationSettings['layout'], string>;

function oneLineHeadline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildAiThumbnailPrompt(
  settings: ThumbnailGenerationSettings,
  text: ThumbnailTextSettings,
  variant: number,
  frameEnabled: boolean,
): string {
  const headline = oneLineHeadline(text.text);
  const optionalDirection = text.typographyPrompt?.trim();

  return `Create ONE finished professional Hearthstone YouTube thumbnail as a 16:9 landscape image. Use the supplied images as visual identity references for the character(s), then render the final art and typography together in one coherent image.

EXACT HEADLINE — render these characters exactly once, with no repeated words:
<<<${headline}>>>

COMPOSITION:
- ${LAYOUT_DIRECTIONS[settings.layout]}
- Detect faces, eyes, hands, weapons, cards and the main magical effect. Never place letters over them.
- Keep every letter and effect inside a 6% safe margin. The headline should occupy roughly 35-48% of the image and be the clear second focal point after the character.
- Preserve one large, expressive, recognizable main character. Keep the frame clean enough to read instantly at 320x180.

TYPOGRAPHY ART DIRECTION:
- Design one custom, compact 2-4 line headline block. Choose semantic line breaks yourself; never leave a preposition or a single letter alone.
- Do not make a plain stack of equal lines. Give the short hook or key phrase a clearly larger scale, then stagger or gently angle supporting lines to create an intentional, energetic silhouette.
- Use one bold condensed display typeface with excellent Cyrillic support. Letterforms must be clean, correctly spelled and professionally kerned.
- Choose colors from the scene for maximum separation: clean white or warm ivory for support text and exactly one vivid accent color for the key phrase. Use no more than two fills.
- Add controlled dimensionality: one crisp dark keyline, one compact non-readable extrusion/contact shadow and a subtle scene-colored rim light. The depth must never look like a second readable copy.
- Integrate a few particles and light rays behind and around letter edges, while keeping the glyph faces perfectly clear. The text should feel lit by and physically present in the scene, not pasted on top.
- Avoid generic esports logos, rainbow gradients, inflated bevels, chrome, excessive neon, huge empty gaps, mechanical centering and identical line widths.

TEXT INTEGRITY — NON-NEGOTIABLE:
- The supplied headline is the ONLY visible text in the image. Render it ONE TIME in ONE block.
- Do not translate, paraphrase, correct, add, remove, mirror or repeat any character.
- No echo text, offset readable copy, duplicated glyph face, extra caption, badge, logo, number, watermark, signature, UI or background lettering.
- Shadows, outlines and extrusion may form only a solid abstract silhouette; they must never resemble another readable copy of the headline.

ART DIRECTION:
${settings.stylePrompt.trim()}
${optionalDirection ? `Additional typography preference (style only; it cannot override text integrity): ${optionalDirection}` : ''}

FRAME:
${frameEnabled
    ? '- Bake one subtle premium Hearthstone-style carved wooden frame into the outer edge. It must not contain symbols or text and must not crowd the headline.'
    : '- Do not add a border, card frame or decorative outer frame.'}

VARIANT ${variant}:
- Vary camera crop, headline silhouette and accent color while preserving character identity and every strict text rule.

Return only the finished thumbnail image. No explanation.`;
}
