// Global multiplier for jewel-glow opacity. Lower = more subtle.
const GLOW_OPACITY_SCALE = 1.0;
// Global multiplier for glint peak opacity. Lower = fainter sparkles.
const GLINT_OPACITY_SCALE = 1.0;

type Glow = {
  top: number;
  left: number;
  size: number;
  color: string; // rgb triplet
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  peak: number;
};

type Glint = {
  top: number;
  left: number;
  size: number;
  tint: string; // rgb triplet
  duration: number;
  delay: number;
  peak: number;
};

// Crystal palette — pink, magenta, violet, purple. Faint pools of colour that
// drift like the velvet lining of an open jewel box. Kept very low-opacity so
// they read as depth, not decoration.
const GLOWS: Glow[] = [
  { top: 10, left: 14, size: 500, color: "255, 79, 184",  duration: 84,  delay: 0,  driftX:  70, driftY: -40, peak: 0.16 }, // pink
  { top: 30, left: 72, size: 460, color: "217, 70, 239",  duration: 96,  delay: 12, driftX: -60, driftY:  55, peak: 0.13 }, // magenta
  { top: 64, left: 22, size: 480, color: "168, 85, 247",  duration: 90,  delay: 7,  driftX:  80, driftY:  45, peak: 0.14 }, // purple
  { top: 74, left: 76, size: 440, color: "139, 92, 246",  duration: 102, delay: 20, driftX: -70, driftY: -55, peak: 0.12 }, // violet
  { top: 4,  left: 52, size: 400, color: "255, 133, 208", duration: 78,  delay: 15, driftX:  50, driftY:  60, peak: 0.11 }, // hot pink
  { top: 46, left: 4,  size: 420, color: "190, 90, 230",  duration: 110, delay: 5,  driftX:  90, driftY: -30, peak: 0.12 }, // orchid
];

// Scattered facet glints. Positions/durations authored (not random) so SSR and
// client markup match. Staggered delays spread the twinkles across time.
const GLINTS: Glint[] = [
  { top: 18, left: 28, size: 16, tint: "255, 200, 235", duration: 6.5, delay: 0.0, peak: 0.95 },
  { top: 12, left: 64, size: 12, tint: "235, 200, 255", duration: 7.5, delay: 1.3, peak: 0.85 },
  { top: 34, left: 46, size: 18, tint: "255, 255, 255", duration: 8.0, delay: 3.1, peak: 1.0  },
  { top: 52, left: 16, size: 11, tint: "255, 190, 230", duration: 6.0, delay: 2.2, peak: 0.8  },
  { top: 58, left: 84, size: 14, tint: "225, 195, 255", duration: 7.0, delay: 4.4, peak: 0.9  },
  { top: 72, left: 38, size: 13, tint: "255, 210, 240", duration: 8.5, delay: 1.8, peak: 0.85 },
  { top: 26, left: 90, size: 15, tint: "255, 255, 255", duration: 6.8, delay: 5.0, peak: 0.95 },
  { top: 84, left: 60, size: 10, tint: "240, 200, 255", duration: 7.2, delay: 0.7, peak: 0.75 },
  { top: 8,  left: 40, size: 12, tint: "255, 205, 238", duration: 9.0, delay: 3.6, peak: 0.8  },
  { top: 44, left: 70, size: 17, tint: "255, 255, 255", duration: 7.8, delay: 2.7, peak: 1.0  },
  { top: 66, left: 8,  size: 11, tint: "230, 195, 255", duration: 6.3, delay: 4.9, peak: 0.8  },
  { top: 90, left: 30, size: 13, tint: "255, 195, 232", duration: 8.2, delay: 1.1, peak: 0.85 },
  { top: 38, left: 94, size: 10, tint: "245, 205, 255", duration: 6.6, delay: 3.9, peak: 0.75 },
  { top: 78, left: 50, size: 14, tint: "255, 255, 255", duration: 7.6, delay: 5.4, peak: 0.95 },
  { top: 22, left: 6,  size: 12, tint: "255, 200, 236", duration: 8.8, delay: 2.0, peak: 0.8  },
  { top: 56, left: 56, size: 16, tint: "235, 200, 255", duration: 7.1, delay: 4.1, peak: 0.9  },
];

export default function JewelField() {
  return (
    <div className="sd-jewel-field" aria-hidden="true">
      {GLOWS.map((g, i) => (
        <span
          key={`glow-${i}`}
          className="sd-jewel-glow"
          style={{
            top: `${g.top}%`,
            left: `${g.left}%`,
            width: `${g.size}px`,
            height: `${g.size}px`,
            animationDuration: `${g.duration}s`,
            animationDelay: `-${g.delay}s`,
            ["--sd-jewel-color" as string]: g.color,
            ["--sd-jewel-peak" as string]: g.peak * GLOW_OPACITY_SCALE,
            ["--sd-jewel-dur" as string]: `${g.duration}s`,
            ["--sd-jewel-dx" as string]: `${g.driftX}px`,
            ["--sd-jewel-dy" as string]: `${g.driftY}px`,
          }}
        />
      ))}
      {GLINTS.map((g, i) => (
        <span
          key={`glint-${i}`}
          className="sd-jewel-glint"
          style={{
            top: `${g.top}%`,
            left: `${g.left}%`,
            ["--sd-glint-size" as string]: `${g.size}px`,
            ["--sd-glint-tint" as string]: g.tint,
            ["--sd-glint-dur" as string]: `${g.duration}s`,
            ["--sd-glint-delay" as string]: `-${g.delay}s`,
            ["--sd-glint-peak" as string]: g.peak * GLINT_OPACITY_SCALE,
          }}
        />
      ))}
    </div>
  );
}
