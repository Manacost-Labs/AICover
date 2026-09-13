import geminiLogo from "../../assets/model-logos/gemini.svg";
import { GENERATION_MODELS, UPSCALE_EXPAND_MODELS } from "../../constants";
import { THUMBNAIL_MODELS } from "../thumbnail/templates";
import type { ModelOption } from "../../components/ui/ModelPicker";

// Display metadata is separate from API IDs and model-dependent settings.
// A future provider can supply its own logo/name per option without changing ModelPicker.
const geminiBrand = { providerName: "Gemini", logoSrc: geminiLogo };

export const generationModelOptions: readonly ModelOption[] =
  GENERATION_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.desc,
    ...geminiBrand,
  }));
export const imageToolModelOptions: readonly ModelOption[] =
  UPSCALE_EXPAND_MODELS.map((model) => ({
    id: model.id,
    name: model.label.replace(/^Gemini /, ""),
    description: model.desc,
    ...geminiBrand,
  }));
export const thumbnailModelOptions: readonly ModelOption[] =
  THUMBNAIL_MODELS.map((model) => ({
    id: model.id,
    name: model.name.replace(/^Gemini /, ""),
    description: model.description,
    ...geminiBrand,
  }));
