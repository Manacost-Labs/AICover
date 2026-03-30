import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

export interface GenerationSettings {
  model: string;
  aspectRatio: "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9";
  imageSize: "512px" | "1K" | "2K" | "4K";
  prompt: string;
  negativePrompt?: string;
  batchSize: number;
  strictMode?: boolean;
}

export interface ImageSource {
  data: string; // base64
  mimeType: string;
}

export async function generateFusedCover(
  sources: ImageSource[],
  reference: ImageSource | null,
  settings: GenerationSettings,
  baseImage: ImageSource | null = null,
  likedImages: string[] = []
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = settings.model;

  // 1. If reference exists, get a text description of its composition first
  let compositionDescription = "";
  if (reference) {
    try {
      const descResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: {
          parts: [
            { text: "Analyze this image as a COMPOSITION TEMPLATE. Identify the main subjects. For each, describe: 1. Position (left, right, center, foreground, background). 2. Pose and scale. 3. Environment perspective. DO NOT describe appearance, only spatial role." },
            {
              inlineData: {
                data: reference.data.split(",")[1] || reference.data,
                mimeType: reference.mimeType,
              },
            },
          ],
        },
      });
      compositionDescription = descResponse.text || "";
    } catch (e) {
      console.error("Failed to describe composition", e);
    }
  }

  const generatePromises: Promise<string[]>[] = [];

  // Since generateContent usually returns one image, we loop for batch size
  for (let i = 0; i < settings.batchSize; i++) {
    const parts: any[] = [];

    // Add source images with explicit labels
    sources.forEach((src, idx) => {
      parts.push({ text: `SOURCE CHARACTER ${idx + 1} (USE THIS EXACTLY):` });
      parts.push({
        inlineData: {
          data: src.data.split(",")[1] || src.data,
          mimeType: src.mimeType,
        },
      });
    });

    // Add base image if refining
    if (baseImage) {
      parts.push({ text: "BASE IMAGE TO REFINE (TEMPLATE):" });
      parts.push({
        inlineData: {
          data: baseImage.data.split(",")[1] || baseImage.data,
          mimeType: baseImage.mimeType,
        },
      });
    }

    if (likedImages.length > 0) {
      parts.push({ text: "EXAMPLES OF HIGH-QUALITY RESULTS (Use these as a benchmark for quality, lighting, and integration):" });
      // Only use up to 3 liked images to avoid overwhelming the prompt
      const recentLikes = likedImages.slice(0, 3);
      for (const likedUrl of recentLikes) {
        try {
          // Extract base64 and mime type from data URL
          const match = likedUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                data: match[2],
                mimeType: match[1],
              },
            });
          }
        } catch (e) {
          console.error("Failed to parse liked image", e);
        }
      }
    }

    // Add prompt with strict instructions
    const fullPrompt = baseImage 
      ? `TASK: SURGICAL REFINEMENT.
         OBJECTIVE: Modify "BASE IMAGE" using "SOURCE CHARACTER" as FIXED ASSETS.
         RULES:
         1. ZERO REDRAWING: Faces, hair, eyes, and features MUST be 100% identical to source.
         2. PIXEL-PERFECT: Use exact silhouettes. No new limbs or armor.
         3. STYLE: VIBRANT FANTASY DIGITAL PAINTING (Hearthstone style).
         4. INTEGRATION: Unified lighting, atmosphere, and contact shadows.
         5. LIGHTING: Single dominant light source. Strong rim lighting.
         6. COLOR: Match environment ambient light.
         7. GROUNDING: Realistic shadows connected to feet.
         8. PROMPT: ${settings.prompt ? `ONLY: ${settings.prompt}` : "Improve integration."}`
      : `TASK: MASTER COMPOSITING - FUSE CHARACTERS.
    RULES:
    1. ZERO REDRAWING: Use source characters as immutable assets.
    2. FIDELITY: Preserve every detail (armor, runes, hair) exactly.
    3. STYLE: VIBRANT FANTASY DIGITAL PAINTING.
    4. ENVIRONMENT: Generate NEW background complementing characters' lighting.
    5. NO COLLAGE: One seamless, unified scene.
    6. LIGHTING: One dominant light source matching characters.
    7. GROUNDING: Shadows connected to feet. No floating.
    
    ${compositionDescription ? `LAYOUT: 
    - Position characters according to template: ${compositionDescription}
    - DO NOT copy template scenery/colors.
    - Match scale and framing.` : ""}`;

    const finalPrompt = `${fullPrompt}
    ${settings.prompt && !baseImage ? `USER: ${settings.prompt}` : ""}
    ${settings.negativePrompt ? `AVOID: ${settings.negativePrompt}, redrawing, changing faces, mutation, extra limbs, collage, split-screen` : "AVOID: redrawing, changing faces, mutation, extra limbs, collage, split-screen"}`;

    parts.push({ text: finalPrompt });

    const imageConfig: any = {
      aspectRatio: settings.aspectRatio,
    };
    
    if (model === "gemini-3.1-flash-image-preview" || model === "gemini-3-pro-image-preview") {
      imageConfig.imageSize = settings.imageSize;
    }

    const generatePromise = ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        imageConfig,
      },
    }).then(response => {
      const generatedUrls: string[] = [];
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          generatedUrls.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
      }
      return generatedUrls;
    });

    generatePromises.push(generatePromise);
  }

  const resultsArrays = await Promise.all(generatePromises);
  const results = resultsArrays.flat();

  return results;
}

export async function upscaleImage(
  image: ImageSource,
  targetSize: "1K" | "2K" | "4K" = "4K",
  model: string = "gemini-3.1-flash-image-preview"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const imageConfig: any = {};
  if (model === "gemini-3.1-flash-image-preview" || model === "gemini-3-pro-image-preview") {
    imageConfig.imageSize = targetSize;
  }

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: image.data.split(",")[1] || image.data,
            mimeType: image.mimeType,
          },
        },
        { text: `UPSCALE TASK: Act as a high-end image restoration and super-resolution engine. 
                 Enhance this image to ${targetSize} resolution. 
                 Improve clarity, sharpen edges, remove compression artifacts, and enhance fine details (textures, hair, skin, materials). 
                 DO NOT change the content, composition, or colors. 
                 The output must be a pixel-perfect, high-resolution version of the input.` },
      ],
    },
    config: {
      imageConfig,
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to upscale image: No image data returned");
}

export async function expandImage(
  image: ImageSource,
  targetAspectRatio: "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9",
  prompt: string = "",
  model: string = "gemini-3.1-flash-image-preview"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            data: image.data.split(",")[1] || image.data,
            mimeType: image.mimeType,
          },
        },
        { text: `OUTPAINTING TASK: Expand this image to a ${targetAspectRatio} aspect ratio. 
                 Maintain the original style, lighting, and content. 
                 Seamlessly extend the background and edges to fill the new frame. 
                 ${prompt ? `USER GUIDANCE: ${prompt}` : "Ensure the expansion is natural and consistent with the original scene."}` },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: targetAspectRatio,
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to expand image: No image data returned");
}
