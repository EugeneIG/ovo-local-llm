// [START] Phase 7 — Curated image-gen model catalog.
// Hand-picked repos that load cleanly through `AutoPipelineForText2Image`
// (or StableDiffusionPipeline fallback). Grouped into "official" (first-
// party releases from Stability AI, Black Forest Labs, Kwai, Google, …)
// and "community" (well-supported fine-tunes popular on Civitai/HF).
//
// The UI shows these as a one-click download list so users don't have
// to hunt through HF search for the right repo. Each entry carries a
// size hint + short blurb so the picker can surface budget guidance.

export type CatalogCategory = "official" | "community";

export interface CatalogModel {
  repo_id: string;
  name: string;
  description: string;
  size_hint: string;
  category: CatalogCategory;
  tags: string[];
}

export const IMAGE_MODEL_CATALOG: ReadonlyArray<CatalogModel> = [
  // ── Official / First-party ────────────────────────────────────────────────
  {
    repo_id: "stabilityai/stable-diffusion-xl-base-1.0",
    name: "Stable Diffusion XL 1.0",
    description: "공식 SDXL 베이스 — 범용 1024px, 대부분의 LoRA/스타일이 호환",
    size_hint: "~6.6GB",
    category: "official",
    tags: ["sdxl", "general", "1024"],
  },
  {
    repo_id: "stabilityai/stable-diffusion-xl-refiner-1.0",
    name: "SDXL Refiner",
    description: "SDXL 후처리용 리파이너. 디테일 향상",
    size_hint: "~5.5GB",
    category: "official",
    tags: ["sdxl", "refiner"],
  },
  {
    repo_id: "stabilityai/sdxl-turbo",
    name: "SDXL Turbo",
    description: "1~4스텝 초고속 SDXL. CFG=0, 즉석 미리보기에 적합",
    size_hint: "~6.4GB",
    category: "official",
    tags: ["sdxl", "turbo", "fast"],
  },
  {
    repo_id: "stabilityai/stable-diffusion-3.5-large",
    name: "Stable Diffusion 3.5 Large",
    description: "2024년 최신 SD 3.5 — 텍스트 이해 대폭 향상",
    size_hint: "~16GB",
    category: "official",
    tags: ["sd3.5", "latest", "large"],
  },
  {
    repo_id: "stabilityai/stable-diffusion-3.5-medium",
    name: "Stable Diffusion 3.5 Medium",
    description: "SD 3.5 중간 사이즈 — 저사양에서도 돌아감",
    size_hint: "~5GB",
    category: "official",
    tags: ["sd3.5", "medium"],
  },
  {
    repo_id: "stabilityai/stable-diffusion-3-medium-diffusers",
    name: "Stable Diffusion 3.0 Medium",
    description: "SD 3.0 초기 버전 (diffusers 컨버전)",
    size_hint: "~4.5GB",
    category: "official",
    tags: ["sd3", "medium"],
  },
  {
    repo_id: "stabilityai/stable-diffusion-2-1",
    name: "Stable Diffusion 2.1",
    description: "SD 2.1 클래식 — 768px",
    size_hint: "~5GB",
    category: "official",
    tags: ["sd2", "classic"],
  },
  {
    repo_id: "runwayml/stable-diffusion-v1-5",
    name: "Stable Diffusion 1.5",
    description: "가장 많이 쓰이는 클래식 SD 1.5 — 512px, LoRA 생태계 最大",
    size_hint: "~4GB",
    category: "official",
    tags: ["sd1.5", "classic", "compat"],
  },
  {
    repo_id: "stabilityai/stable-diffusion-x4-upscaler",
    name: "SD x4 업스케일러",
    description: "업스케일 기능이 쓰는 x4 diffusion 업스케일러",
    size_hint: "~1.5GB",
    category: "official",
    tags: ["upscaler"],
  },
  {
    repo_id: "black-forest-labs/FLUX.1-schnell",
    name: "FLUX.1 [schnell]",
    description: "Apache-2.0 — 4스텝 초고속. 상업 이용 가능",
    size_hint: "~24GB",
    category: "official",
    tags: ["flux", "fast", "apache"],
  },
  {
    repo_id: "black-forest-labs/FLUX.1-dev",
    name: "FLUX.1 [dev]",
    description: "FLUX 고품질 (비상업). 2024년 최강급 품질",
    size_hint: "~24GB",
    category: "official",
    tags: ["flux", "quality"],
  },
  {
    repo_id: "Kwai-Kolors/Kolors-diffusers",
    name: "Kolors",
    description: "한·중·영 다국어 텍스트 인코더. 한글 프롬프트 지원",
    size_hint: "~12GB",
    category: "official",
    tags: ["multilingual", "ko", "zh"],
  },
  {
    repo_id: "kandinsky-community/kandinsky-3",
    name: "Kandinsky 3.0",
    description: "다국어 지원, 독특한 아트 스타일",
    size_hint: "~15GB",
    category: "official",
    tags: ["multilingual", "art"],
  },
  {
    repo_id: "PixArt-alpha/PixArt-Sigma-XL-2-1024-MS",
    name: "PixArt-Σ 1024px",
    description: "DiT 아키텍처. 경량·고품질",
    size_hint: "~4GB",
    category: "official",
    tags: ["dit", "light"],
  },
  {
    repo_id: "fal/AuraFlow-v0.3",
    name: "AuraFlow v0.3",
    description: "오픈소스 flow-matching 모델",
    size_hint: "~13GB",
    category: "official",
    tags: ["flow"],
  },

  // ── Community / Popular Fine-tunes ───────────────────────────────────────
  {
    repo_id: "RunDiffusion/Juggernaut-XL-v9",
    name: "Juggernaut XL v9",
    description: "실사 사진 계열 SDXL 파인튠 — 인물·풍경 강함",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "realistic", "photo"],
  },
  {
    repo_id: "SG161222/RealVisXL_V4.0",
    name: "RealVisXL V4.0",
    description: "초실사 SDXL — 디테일 극강",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "hyperrealistic"],
  },
  {
    repo_id: "Lykon/dreamshaper-xl-1-0",
    name: "DreamShaper XL 1.0",
    description: "아트·사진 하이브리드. 실험용으로 많이 쓰임",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "hybrid"],
  },
  {
    repo_id: "playgroundai/playground-v2.5-1024px-aesthetic",
    name: "Playground v2.5",
    description: "Playground 공개 모델 — 미적 감각 강조",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "aesthetic"],
  },
  {
    repo_id: "AstraliteHeart/pony-diffusion-v6-xl",
    name: "Pony Diffusion V6 XL",
    description: "스타일드 / 애니메이션 SDXL 파인튠. LoRA 풍부",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "anime", "style"],
  },
  {
    repo_id: "cagliostrolab/animagine-xl-3.1",
    name: "Animagine XL 3.1",
    description: "애니메 전문 SDXL. 캐릭터 태그 시스템",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "anime"],
  },
  {
    repo_id: "ByteDance/SDXL-Lightning",
    name: "SDXL Lightning",
    description: "ByteDance 2~8스텝 초고속 SDXL",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "fast"],
  },
  {
    repo_id: "playgroundai/playground-v2-1024px-aesthetic",
    name: "Playground v2",
    description: "Playground v2 미적 모델 (v2.5의 이전 세대)",
    size_hint: "~6.6GB",
    category: "community",
    tags: ["sdxl", "aesthetic"],
  },
  {
    repo_id: "segmind/SSD-1B",
    name: "Segmind SSD-1B",
    description: "SDXL을 1/2로 증류 — 50% 빠름, 비슷한 품질",
    size_hint: "~4.5GB",
    category: "community",
    tags: ["sdxl", "distilled", "fast"],
  },
];

export function catalogByCategory(): Record<CatalogCategory, CatalogModel[]> {
  const out: Record<CatalogCategory, CatalogModel[]> = {
    official: [],
    community: [],
  };
  for (const m of IMAGE_MODEL_CATALOG) out[m.category].push(m);
  return out;
}
// [END] Phase 7
