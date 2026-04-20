// [START] Phase 7 — SDXL style presets.
// Each entry wraps the user prompt in a template that biases the model
// toward a specific aesthetic (anime / photographic / comic / 3D / …).
// Prompt templates use the literal `{prompt}` token — the generator
// substitutes the user's input before sending to the diffusion runner.
// Negative prompts are ADDED to the user's existing negative prompt.
//
// Base list comes from the Stability-AI "SAI" style catalog that ships
// with the SDXL prompt engineering guide; entries 0..24 are the canonical
// set. Order is what appears in the UI; "none" (prompt passthrough) is
// always first.

export interface ImageStylePreset {
  id: string;
  name: string;
  category: "none" | "photo" | "art" | "illustration" | "3d" | "abstract";
  prompt: string;
  negative_prompt: string;
}

export const IMAGE_STYLE_PRESETS: ReadonlyArray<ImageStylePreset> = [
  {
    id: "none",
    name: "None",
    category: "none",
    prompt: "{prompt}",
    negative_prompt: "",
  },
  {
    id: "enhance",
    name: "Enhance",
    category: "photo",
    prompt:
      "breathtaking {prompt}. award-winning, professional, highly detailed",
    negative_prompt:
      "ugly, deformed, noisy, blurry, distorted, grainy",
  },
  {
    id: "anime",
    name: "Anime",
    category: "illustration",
    prompt:
      "anime artwork {prompt}. anime style, key visual, vibrant, studio anime, highly detailed",
    negative_prompt:
      "photo, deformed, black and white, realism, disfigured, low contrast",
  },
  {
    id: "photographic",
    name: "Photographic",
    category: "photo",
    prompt:
      "cinematic photo {prompt}. 35mm photograph, film, bokeh, professional, 4k, highly detailed",
    negative_prompt:
      "drawing, painting, crayon, sketch, graphite, impressionist, noisy, blurry, soft, deformed, ugly",
  },
  {
    id: "digital-art",
    name: "Digital Art",
    category: "art",
    prompt:
      "concept art {prompt}. digital artwork, illustrative, painterly, matte painting, highly detailed",
    negative_prompt: "photo, photorealistic, realism, ugly",
  },
  {
    id: "comic-book",
    name: "Comic Book",
    category: "illustration",
    prompt:
      "comic {prompt}. graphic illustration, comic art, graphic novel art, vibrant, highly detailed",
    negative_prompt:
      "photograph, deformed, glitch, noisy, realistic, stock photo",
  },
  {
    id: "fantasy-art",
    name: "Fantasy Art",
    category: "art",
    prompt:
      "ethereal fantasy concept art of {prompt}. magnificent, celestial, ethereal, painterly, epic, majestic, magical, fantasy art, cover art, dreamy",
    negative_prompt:
      "photographic, realistic, realism, 35mm film, dslr, cropped, frame, text, deformed, glitch, noise, noisy, off-center, cross-eyed, closed eyes, bad anatomy, ugly, disfigured, sloppy, duplicate, mutated, black and white",
  },
  {
    id: "analog-film",
    name: "Analog Film",
    category: "photo",
    prompt:
      "analog film photo {prompt}. faded film, desaturated, 35mm photo, grainy, vignette, vintage, Kodachrome, Lomography, stained, highly detailed, found footage",
    negative_prompt:
      "painting, drawing, illustration, glitch, deformed, mutated, cross-eyed, ugly, disfigured",
  },
  {
    id: "neon-punk",
    name: "Neon Punk",
    category: "art",
    prompt:
      "neonpunk style {prompt}. cyberpunk, vaporwave, neon, vibes, vibrant, stunningly beautiful, crisp, detailed, sleek, ultramodern, magenta highlights, dark purple shadows, high contrast, cinematic, ultra detailed, intricate, professional",
    negative_prompt:
      "painting, drawing, illustration, glitch, deformed, mutated, cross-eyed, ugly, disfigured",
  },
  {
    id: "isometric",
    name: "Isometric",
    category: "3d",
    prompt:
      "isometric style {prompt}. vibrant, beautiful, crisp, detailed, ultra detailed, intricate",
    negative_prompt:
      "deformed, mutated, ugly, disfigured, blur, blurry, noise, noisy, realistic, photographic",
  },
  {
    id: "line-art",
    name: "Line Art",
    category: "illustration",
    prompt:
      "line art drawing {prompt}. professional, sleek, modern, minimalist, graphic, line art, vector graphics",
    negative_prompt:
      "anime, photorealistic, 35mm film, deformed, glitch, blurry, noisy, off-center, cross-eyed, closed eyes, bad anatomy, ugly, disfigured, mutated, realism, realistic, impressionism, expressionism, oil, acrylic",
  },
  {
    id: "craft-clay",
    name: "Craft Clay",
    category: "3d",
    prompt:
      "play-doh style {prompt}. sculpture, clay art, centered composition, Claymation",
    negative_prompt: "sloppy, messy, blurry, deformed, noisy, disfigured",
  },
  {
    id: "cinematic",
    name: "Cinematic",
    category: "photo",
    prompt:
      "cinematic film still {prompt}. shallow depth of field, vignette, highly detailed, high budget, bokeh, cinemascope, moody, epic, gorgeous, film grain, grainy",
    negative_prompt:
      "anime, cartoon, graphic, text, painting, crayon, graphite, abstract, glitch, deformed, mutated, ugly, disfigured",
  },
  {
    id: "3d-model",
    name: "3D Model",
    category: "3d",
    prompt:
      "professional 3d model {prompt}. octane render, highly detailed, volumetric, dramatic lighting",
    negative_prompt: "ugly, deformed, noisy, low poly, blurry, painting",
  },
  {
    id: "pixel-art",
    name: "Pixel Art",
    category: "illustration",
    prompt:
      "pixel-art {prompt}. low-res, blocky, pixel art style, 8-bit graphics",
    negative_prompt:
      "sloppy, messy, blurry, noisy, highly detailed, ultra textured, photo, realistic",
  },
  {
    id: "low-poly",
    name: "Low Poly",
    category: "3d",
    prompt:
      "low-poly style {prompt}. low-poly game art, polygon mesh, jagged, blocky, wireframe edges, centered composition",
    negative_prompt:
      "noisy, sloppy, messy, grainy, highly detailed, ultra textured, photo",
  },
  {
    id: "origami",
    name: "Origami",
    category: "illustration",
    prompt:
      "origami style {prompt}. paper art, pleated paper, folded, origami art, pleats, cut and fold, centered composition",
    negative_prompt:
      "noisy, sloppy, messy, grainy, highly detailed, ultra textured, photo",
  },
  {
    id: "pixel-cute",
    name: "Kawaii",
    category: "illustration",
    prompt:
      "kawaii style {prompt}. cute, adorable, brightly colored, cheerful, anime influence, highly detailed, sparkles",
    negative_prompt: "ugly, gritty, dark, edgy, grim, horror, realistic",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    category: "art",
    prompt:
      "watercolor painting of {prompt}. soft washes, wet on wet technique, paper texture, flowing pigments, delicate brushstrokes",
    negative_prompt:
      "photo, photorealistic, realism, digital art, 3d render, sharp, hard edges",
  },
  {
    id: "oil-painting",
    name: "Oil Painting",
    category: "art",
    prompt:
      "oil painting of {prompt}. thick impasto brushstrokes, rich color, classical painting, canvas texture, highly detailed",
    negative_prompt:
      "photo, photorealistic, digital art, 3d render, cartoon, anime, sketch",
  },
  {
    id: "ink-sketch",
    name: "Ink Sketch",
    category: "illustration",
    prompt:
      "ink sketch drawing of {prompt}. black and white, pen and ink, cross-hatching, detailed linework, monochrome",
    negative_prompt: "color, painting, photo, realistic, 3d render, blurry",
  },
  {
    id: "vaporwave",
    name: "Vaporwave",
    category: "abstract",
    prompt:
      "vaporwave aesthetic {prompt}. pastel pink and teal, retro 80s, glitch art, chrome, palm trees, sunset, dreamy, nostalgic",
    negative_prompt:
      "realistic, photorealistic, dull, muted colors, modern, realism",
  },
  {
    id: "steampunk",
    name: "Steampunk",
    category: "art",
    prompt:
      "steampunk style {prompt}. brass gears, Victorian era, mechanical, retrofuturistic, warm sepia tones, ornate, detailed craftsmanship",
    negative_prompt:
      "modern, contemporary, minimalist, photorealistic, digital",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    category: "art",
    prompt:
      "cyberpunk scene {prompt}. neon-lit, dystopian, rainy city streets, holographic signs, futuristic tech, high contrast, cinematic lighting",
    negative_prompt:
      "rural, nature, daylight, bright, cheerful, historical",
  },
  {
    id: "studio-ghibli",
    name: "Studio Ghibli",
    category: "illustration",
    prompt:
      "Studio Ghibli inspired {prompt}. soft pastel colors, hand-painted backgrounds, whimsical, nature-focused, magical realism, anime movie still",
    negative_prompt:
      "photo, realism, 3d render, harsh lighting, dark, gritty, hyperrealistic",
  },
];

export function getStylePreset(id: string): ImageStylePreset {
  return IMAGE_STYLE_PRESETS.find((p) => p.id === id) ?? IMAGE_STYLE_PRESETS[0];
}

/** Merge a user prompt + negative through a style preset. */
export function applyStylePreset(
  preset: ImageStylePreset,
  userPrompt: string,
  userNegative: string,
): { prompt: string; negative: string } {
  const prompt = preset.prompt.replace("{prompt}", userPrompt.trim());
  const neg = [userNegative.trim(), preset.negative_prompt]
    .filter((p) => p.length > 0)
    .join(", ");
  return { prompt, negative: neg };
}
// [END] Phase 7
