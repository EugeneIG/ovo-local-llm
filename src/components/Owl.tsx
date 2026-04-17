export type OwlState =
  | "idle"       // default — big open eyes
  | "thinking"   // eyes upward, question marks
  | "typing"     // focused squint
  | "sleeping"   // closed eyes + zzz
  | "happy"      // curved happy eyes + sparkles
  | "surprised"  // huge dilated pupils
  | "error"      // X eyes
  | "struggling"; // grabbed — flailing, sweat drops, shake animation

export type OwlSize = "xs" | "sm" | "md" | "lg" | "xl";

export const OWL_SIZES: Record<OwlSize, number> = {
  xs: 32,
  sm: 64,
  md: 128,
  lg: 220,
  xl: 320,
};

export interface OwlProps {
  state?: OwlState;
  size?: number | OwlSize;
  className?: string;
  accent?: string;
}

const PALETTE = {
  body: "#D97757",
  bodyShadow: "#B85D3F",
  belly: "#F4D4B8",
  face: "#F4D4B8",
  eyeRing: "#FAF3E7",
  eyeStroke: "#8B4432",
  iris: "#2C1810",
  beak: "#E8A053",
  beakStroke: "#B8702F",
  feet: "#8B6542",
  feetShadow: "#6B4A2A",
  blush: "#E88B6F",
  toes: "#8B4A2A",
};

function Eyes({ state }: { state: OwlState }) {
  const ringProps = {
    fill: PALETTE.eyeRing,
    stroke: PALETTE.eyeStroke,
    strokeWidth: 2.5,
  };

  if (state === "sleeping") {
    return (
      <g>
        <circle cx="290" cy="225" r="48" {...ringProps} />
        <circle cx="390" cy="225" r="48" {...ringProps} />
        <path d="M 264 225 Q 290 240 316 225" stroke={PALETTE.iris} strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M 364 225 Q 390 240 416 225" stroke={PALETTE.iris} strokeWidth="5" fill="none" strokeLinecap="round" />
        <text x="460" y="160" fill={PALETTE.eyeStroke} fontSize="28" fontFamily="serif" fontWeight="bold">z</text>
        <text x="482" y="132" fill={PALETTE.eyeStroke} fontSize="36" fontFamily="serif" fontWeight="bold">Z</text>
      </g>
    );
  }

  if (state === "happy") {
    return (
      <g>
        <circle cx="290" cy="225" r="48" {...ringProps} />
        <circle cx="390" cy="225" r="48" {...ringProps} />
        <path d="M 260 238 Q 290 208 320 238" stroke={PALETTE.iris} strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M 360 238 Q 390 208 420 238" stroke={PALETTE.iris} strokeWidth="6" fill="none" strokeLinecap="round" />
      </g>
    );
  }

  if (state === "error") {
    return (
      <g>
        <circle cx="290" cy="225" r="48" {...ringProps} />
        <circle cx="390" cy="225" r="48" {...ringProps} />
        <g stroke={PALETTE.iris} strokeWidth="7" strokeLinecap="round">
          <line x1="270" y1="205" x2="310" y2="245" />
          <line x1="310" y1="205" x2="270" y2="245" />
          <line x1="370" y1="205" x2="410" y2="245" />
          <line x1="410" y1="205" x2="370" y2="245" />
        </g>
      </g>
    );
  }

  if (state === "struggling") {
    return (
      <g>
        <circle cx="290" cy="225" r="48" {...ringProps} />
        <circle cx="390" cy="225" r="48" {...ringProps} />
        <circle cx="295" cy="222" r="26" fill={PALETTE.iris} />
        <circle cx="385" cy="222" r="26" fill={PALETTE.iris} />
        <circle cx="305" cy="214" r="5" fill="#FFFFFF" />
        <circle cx="395" cy="214" r="5" fill="#FFFFFF" />
        <path d="M 248 218 Q 254 202 268 200" stroke={PALETTE.eyeStroke} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 412 200 Q 426 202 432 218" stroke={PALETTE.eyeStroke} strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
    );
  }

  const irisR = state === "surprised" ? 28 : state === "typing" ? 18 : 22;
  const irisOffsetY = state === "thinking" ? -8 : 0;
  const pupilR = state === "surprised" ? 4 : state === "typing" ? 5 : 7;

  return (
    <g>
      <circle cx="290" cy="225" r="48" {...ringProps} />
      <circle cx="390" cy="225" r="48" {...ringProps} />
      <circle cx="295" cy={230 + irisOffsetY} r={irisR} fill={PALETTE.iris} />
      <circle cx="385" cy={230 + irisOffsetY} r={irisR} fill={PALETTE.iris} />
      <circle cx="302" cy={222 + irisOffsetY} r={pupilR} fill="#FFFFFF" />
      <circle cx="392" cy={222 + irisOffsetY} r={pupilR} fill="#FFFFFF" />
      <circle cx="287" cy={237 + irisOffsetY} r="3" fill="#FFFFFF" />
      <circle cx="377" cy={237 + irisOffsetY} r="3" fill="#FFFFFF" />
      {state === "typing" && (
        <path d="M 440 190 Q 446 202 440 212 Q 434 202 440 190 Z" fill="#5FA8D3" opacity="0.8" />
      )}
    </g>
  );
}

function Accessory({ state }: { state: OwlState }) {
  if (state === "thinking") {
    return (
      <g>
        <circle cx="520" cy="120" r="12" fill={PALETTE.eyeRing} stroke={PALETTE.eyeStroke} strokeWidth="2" />
        <circle cx="540" cy="90" r="18" fill={PALETTE.eyeRing} stroke={PALETTE.eyeStroke} strokeWidth="2" />
        <circle cx="575" cy="55" r="28" fill={PALETTE.eyeRing} stroke={PALETTE.eyeStroke} strokeWidth="2" />
        <text x="560" y="68" fill={PALETTE.eyeStroke} fontSize="32" fontWeight="bold">?</text>
      </g>
    );
  }
  if (state === "happy") {
    return (
      <g stroke={PALETTE.beak} strokeWidth="3" strokeLinecap="round" fill="none">
        <line x1="120" y1="200" x2="140" y2="210" />
        <line x1="130" y1="175" x2="140" y2="195" />
        <line x1="560" y1="200" x2="540" y2="210" />
        <line x1="550" y1="175" x2="540" y2="195" />
      </g>
    );
  }
  if (state === "struggling") {
    return (
      <g>
        <g fill="#5FA8D3" opacity="0.85">
          <path d="M 170 210 Q 164 226 170 240 Q 176 226 170 210 Z" />
          <path d="M 510 210 Q 504 226 510 240 Q 516 226 510 210 Z" />
          <path d="M 140 280 Q 134 298 140 314 Q 146 298 140 280 Z" />
        </g>
        <g stroke={PALETTE.eyeStroke} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.65">
          <path d="M 100 250 Q 125 245 145 260" />
          <path d="M 90 320 Q 118 320 140 335" />
          <path d="M 580 250 Q 555 245 535 260" />
          <path d="M 590 320 Q 562 320 540 335" />
        </g>
        <g stroke={PALETTE.eyeStroke} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M 198 170 Q 175 140 165 110" />
          <path d="M 482 170 Q 505 140 515 110" />
        </g>
      </g>
    );
  }
  return null;
}

function Mouth({ state }: { state: OwlState }) {
  if (state === "struggling" || state === "surprised") {
    return (
      <g>
        <ellipse cx="340" cy="292" rx="18" ry="22" fill="#2C1810" />
        <ellipse cx="340" cy="298" rx="10" ry="12" fill="#B8405E" />
      </g>
    );
  }
  return null;
}

export function Owl({ state = "idle", size = "md", className = "", accent }: OwlProps) {
  const px = typeof size === "number" ? size : OWL_SIZES[size];
  const body = accent ?? PALETTE.body;
  const stateClass = state === "struggling" ? "ovo-owl-struggling" : "";
  return (
    <svg
      viewBox="0 0 680 480"
      width={px}
      height={(px * 480) / 680}
      className={`${stateClass} ${className}`.trim()}
      role="img"
      aria-label={`owl ${state}`}
    >
      <path d="M 140 418 Q 340 410 540 418 L 540 436 Q 340 428 140 436 Z" fill={PALETTE.feet} />
      <ellipse cx="220" cy="418" rx="18" ry="3" fill={PALETTE.feetShadow} opacity="0.5" />
      <ellipse cx="420" cy="418" rx="22" ry="3" fill={PALETTE.feetShadow} opacity="0.5" />

      <path d="M 255 138 L 248 92 L 288 128 Z" fill={PALETTE.bodyShadow} />
      <path d="M 425 138 L 432 92 L 392 128 Z" fill={PALETTE.bodyShadow} />

      <path
        d="M 340 110 C 228 112 192 218 198 312 C 204 398 272 428 340 428 C 408 428 476 398 482 312 C 488 218 452 108 340 110 Z"
        fill={body}
      />
      <ellipse cx="340" cy="325" rx="78" ry="98" fill={PALETTE.belly} />

      <path d="M 210 240 Q 188 315 212 398 Q 248 385 250 325 Q 248 268 210 240 Z" fill={PALETTE.bodyShadow} />
      <path d="M 470 240 Q 492 315 468 398 Q 432 385 430 325 Q 432 268 470 240 Z" fill={PALETTE.bodyShadow} />

      <g stroke="#8B4432" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.6">
        <path d="M 218 290 Q 230 295 238 315" />
        <path d="M 218 330 Q 230 335 238 355" />
        <path d="M 462 290 Q 450 295 442 315" />
        <path d="M 462 330 Q 450 335 442 355" />
      </g>

      <ellipse cx="340" cy="228" rx="118" ry="98" fill={PALETTE.face} />

      <Eyes state={state} />

      {state !== "struggling" && state !== "surprised" && (
        <path
          d="M 340 260 L 322 285 L 340 302 L 358 285 Z"
          fill={PALETTE.beak}
          stroke={PALETTE.beakStroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}

      <Mouth state={state} />

      <ellipse cx="240" cy="268" rx="16" ry="9" fill={PALETTE.blush} opacity="0.55" />
      <ellipse cx="440" cy="268" rx="16" ry="9" fill={PALETTE.blush} opacity="0.55" />

      <g stroke={PALETTE.toes} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M 303 410 L 298 432" />
        <path d="M 320 410 L 320 432" />
        <path d="M 337 410 L 342 432" />
        <path d="M 343 410 L 338 432" />
        <path d="M 360 410 L 360 432" />
        <path d="M 377 410 L 382 432" />
      </g>

      <Accessory state={state} />
    </svg>
  );
}

export default Owl;
