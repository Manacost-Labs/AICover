import type { ThumbnailGenerationSettings } from './types';

const LAYOUT_PROMPTS = {
  'text-left': `Place the MAIN CHARACTER in the RIGHT 55% of the frame. Keep the LEFT 45% dark, clean and low-detail as negative space for a large headline. Do not put faces, weapons or bright particles in the headline area.`,
  'text-right': `Place the MAIN CHARACTER in the LEFT 55% of the frame. Keep the RIGHT 45% dark, clean and low-detail as negative space for a large headline. Do not put faces, weapons or bright particles in the headline area.`,
  center: `Place the MAIN CHARACTER prominently in the center and upper two-thirds. Keep the LOWER 35% darker and low-detail for a large headline. Keep the face unobstructed.`,
} satisfies Record<ThumbnailGenerationSettings['layout'], string>;

export function buildThumbnailPrompt(settings: ThumbnailGenerationSettings, variant: number): string {
  return `TASK: CREATE A HIGH-IMPACT HEARTHSTONE VIDEO THUMBNAIL BACKGROUND.

ASSET RULES:
- Treat every supplied game image as an identity reference.
- Preserve faces, armor, weapons, colors and recognizable silhouettes.
- The first image is the MAIN CHARACTER. Other images are supporting subjects.
- Integrate all subjects into one coherent scene with unified lighting.

COMPOSITION:
${LAYOUT_PROMPTS[settings.layout]}
- Use a 16:9 cinematic composition with strong foreground/background separation.
- Keep all important anatomy and weapons inside the frame.

ART DIRECTION:
${settings.stylePrompt.trim()}

STRICT OUTPUT RULES:
- ARTWORK ONLY.
- NO words, letters, numbers, captions, logos, watermarks, card frames or user interface.
- Do not invent extra characters, limbs, weapons or duplicated faces.
- Do not make a split-screen collage.

VARIANT ${variant}: Change only camera distance, magical effects and background rhythm. Preserve subject identity and the required headline safe zone.`;
}
