// Global multiplier for particle opacity. Lower = more subtle, higher = more
// visible. 1.0 uses the per-particle values as authored.
const OPACITY_SCALE = 1.5;

type Spark = {
  left: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
  swayAmp: number;
};

const SPARKS: Spark[] = [
  { left: 4,  size: 2, duration: 22, delay: 0,   drift: 18,  opacity: 0.30, swayAmp: 10 },
  { left: 11, size: 3, duration: 28, delay: 4,   drift: -24, opacity: 0.22, swayAmp: 14 },
  { left: 17, size: 2, duration: 19, delay: 9,   drift: 14,  opacity: 0.35, swayAmp: 8  },
  { left: 23, size: 4, duration: 32, delay: 2,   drift: -30, opacity: 0.18, swayAmp: 18 },
  { left: 29, size: 2, duration: 24, delay: 11,  drift: 20,  opacity: 0.28, swayAmp: 12 },
  { left: 34, size: 3, duration: 26, delay: 6,   drift: -16, opacity: 0.24, swayAmp: 11 },
  { left: 41, size: 2, duration: 21, delay: 13,  drift: 22,  opacity: 0.32, swayAmp: 9  },
  { left: 47, size: 3, duration: 30, delay: 1,   drift: -20, opacity: 0.20, swayAmp: 15 },
  { left: 53, size: 2, duration: 23, delay: 8,   drift: 16,  opacity: 0.30, swayAmp: 10 },
  { left: 59, size: 4, duration: 34, delay: 15,  drift: -28, opacity: 0.16, swayAmp: 20 },
  { left: 64, size: 2, duration: 20, delay: 3,   drift: 12,  opacity: 0.33, swayAmp: 7  },
  { left: 70, size: 3, duration: 27, delay: 10,  drift: -18, opacity: 0.22, swayAmp: 13 },
  { left: 76, size: 2, duration: 25, delay: 5,   drift: 24,  opacity: 0.28, swayAmp: 11 },
  { left: 82, size: 3, duration: 29, delay: 14,  drift: -22, opacity: 0.20, swayAmp: 16 },
  { left: 87, size: 2, duration: 18, delay: 7,   drift: 16,  opacity: 0.34, swayAmp: 8  },
  { left: 92, size: 4, duration: 33, delay: 12,  drift: -26, opacity: 0.17, swayAmp: 19 },
  { left: 96, size: 2, duration: 22, delay: 0,   drift: 14,  opacity: 0.30, swayAmp: 9  },
  { left: 38, size: 2, duration: 31, delay: 17,  drift: -12, opacity: 0.26, swayAmp: 12 },
];

export default function SparkField() {
  return (
    <div className="sd-spark-field" aria-hidden="true">
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="sd-spark-particle"
          style={{
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDuration: `${s.duration}s`,
            animationDelay: `-${s.delay}s`,
            ["--sd-drift" as string]: `${s.drift}px`,
            ["--sd-sway-amp" as string]: `${s.swayAmp}px`,
            ["--sd-peak-opacity" as string]: s.opacity * OPACITY_SCALE,
          }}
        />
      ))}
    </div>
  );
}
