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
        <text x="460" y="160" fill={PALETTE.eyeStroke} fontSize="28" fontFamily="serif" fontWeight="bold" className="ovo-owl-zzz-1">z</text>
        <text x="482" y="132" fill={PALETTE.eyeStroke} fontSize="36" fontFamily="serif" fontWeight="bold" className="ovo-owl-zzz-2">Z</text>
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
  const irisClass = state === "typing" ? "ovo-owl-iris-typing" : "";
  const eyeClass = state === "idle" ? "ovo-owl-eye-blink" : "";

  return (
    <g>
      <circle cx="290" cy="225" r="48" {...ringProps} />
      <circle cx="390" cy="225" r="48" {...ringProps} />
      <g className={eyeClass}>
        <g className={irisClass}>
          <circle cx="295" cy={230 + irisOffsetY} r={irisR} fill={PALETTE.iris} />
          <circle cx="302" cy={222 + irisOffsetY} r={pupilR} fill="#FFFFFF" />
          <circle cx="287" cy={237 + irisOffsetY} r="3" fill="#FFFFFF" />
        </g>
        <g className={irisClass}>
          <circle cx="385" cy={230 + irisOffsetY} r={irisR} fill={PALETTE.iris} />
          <circle cx="392" cy={222 + irisOffsetY} r={pupilR} fill="#FFFFFF" />
          <circle cx="377" cy={237 + irisOffsetY} r="3" fill="#FFFFFF" />
        </g>
      </g>
      {state === "typing" && (
        <path d="M 440 190 Q 446 202 440 212 Q 434 202 440 190 Z" fill="#5FA8D3" opacity="0.8" className="ovo-owl-flutter" />
      )}
    </g>
  );
}

function Accessory({ state }: { state: OwlState }) {
  if (state === "thinking") {
    return (
      <g>
        <circle cx="502" cy="132" r="8" fill={PALETTE.eyeRing} stroke={PALETTE.eyeStroke} strokeWidth="2" className="ovo-owl-thought" />
        <circle cx="520" cy="108" r="12" fill={PALETTE.eyeRing} stroke={PALETTE.eyeStroke} strokeWidth="2" className="ovo-owl-thought ovo-owl-thought-2" />
        <g className="ovo-owl-thought ovo-owl-thought-3">
          <path
            d="M 540 85 Q 530 60 555 55 Q 570 30 600 45 Q 625 35 632 60 Q 650 68 642 90 Q 650 110 625 115 Q 610 130 585 120 Q 560 130 548 110 Q 530 105 540 85 Z"
            fill={PALETTE.eyeRing}
            stroke={PALETTE.eyeStroke}
            strokeWidth="2.5"
          />
          <circle cx="570" cy="82" r="4.5" fill={PALETTE.eyeStroke} />
          <circle cx="594" cy="82" r="4.5" fill={PALETTE.eyeStroke} />
          <circle cx="618" cy="82" r="4.5" fill={PALETTE.eyeStroke} />
        </g>
      </g>
    );
  }
  if (state === "typing") {
    return (
      <g>
        <g>
          <path d="M 108 478 L 572 478 L 556 420 L 124 420 Z" fill="#1A1008" />
          <path d="M 118 472 L 562 472 L 548 424 L 132 424 Z" fill="#2C1810" />
          {(() => {
            const rowDefs = [
              { y: 430, keys: 12, indent: 0 },
              { y: 443, keys: 11, indent: 10 },
              { y: 456, keys: 10, indent: 20 },
            ];
            const keys: JSX.Element[] = [];
            rowDefs.forEach((row, rowIdx) => {
              const rowWidth = 430 - row.indent * 2;
              const keyGap = 2;
              const keyW = (rowWidth - keyGap * (row.keys - 1)) / row.keys;
              const keyH = 10;
              const startX = 125 + row.indent;
              for (let i = 0; i < row.keys; i++) {
                const x = startX + i * (keyW + keyGap);
                keys.push(
                  <g key={`r${rowIdx}-k${i}`}>
                    <rect x={x} y={row.y} width={keyW} height={keyH} rx="1.5" fill="#4A3220" />
                    <rect x={x + 0.5} y={row.y + 0.5} width={keyW - 1} height={keyH - 3} rx="1" fill="#6B4A30" />
                  </g>,
                );
              }
            });
            return <g>{keys}</g>;
          })()}
          <g>
            <rect x="200" y="466" width="220" height="8" rx="1.5" fill="#4A3220" />
            <rect x="201" y="466.5" width="218" height="5" rx="1" fill="#6B4A30" />
          </g>
          <g>
            <rect x="170" y="466" width="26" height="8" rx="1.5" fill="#4A3220" />
            <rect x="424" y="466" width="26" height="8" rx="1.5" fill="#4A3220" />
            <rect x="454" y="466" width="26" height="8" rx="1.5" fill="#4A3220" />
          </g>
          <rect x="124" y="420" width="432" height="2" fill="#6B4A30" opacity="0.4" />
        </g>
        <g className="ovo-owl-typing-arm-l">
          <path
            d="M 220 310 Q 178 360 196 440 Q 222 448 252 438 Q 268 380 250 330 Q 240 315 220 310 Z"
            fill={PALETTE.bodyShadow}
            stroke={PALETTE.eyeStroke}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <g stroke={PALETTE.eyeStroke} strokeWidth="1.5" fill="none" opacity="0.55" strokeLinecap="round">
            <path d="M 212 340 Q 218 390 210 430" />
            <path d="M 232 340 Q 238 395 232 436" />
          </g>
        </g>
        <g className="ovo-owl-typing-arm-r">
          <path
            d="M 460 310 Q 502 360 484 440 Q 458 448 428 438 Q 412 380 430 330 Q 440 315 460 310 Z"
            fill={PALETTE.bodyShadow}
            stroke={PALETTE.eyeStroke}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <g stroke={PALETTE.eyeStroke} strokeWidth="1.5" fill="none" opacity="0.55" strokeLinecap="round">
            <path d="M 468 340 Q 462 390 470 430" />
            <path d="M 448 340 Q 442 395 448 436" />
          </g>
        </g>
        <g className="ovo-owl-flutter" fill="#5FA8D3" opacity="0.85">
          <text x="128" y="424" fontSize="14" fontFamily="monospace" fontWeight="bold">
            tap
          </text>
          <text x="510" y="424" fontSize="14" fontFamily="monospace" fontWeight="bold">
            tap
          </text>
        </g>
      </g>
    );
  }
  if (state === "happy") {
    return (
      <g stroke={PALETTE.beak} strokeWidth="3" strokeLinecap="round" fill="none">
        <g className="ovo-owl-sparkle-1">
          <line x1="120" y1="200" x2="140" y2="210" />
          <line x1="130" y1="175" x2="140" y2="195" />
        </g>
        <g className="ovo-owl-sparkle-2">
          <line x1="560" y1="200" x2="540" y2="210" />
          <line x1="550" y1="175" x2="540" y2="195" />
        </g>
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
  const stateClass = `ovo-owl-${state}`;
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
