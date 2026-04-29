// Global multiplier for nebula blob opacity. Lower = more subtle, higher = more
// visible. 1.0 uses the per-blob values as authored.
const OPACITY_SCALE = 1.0;

type Blob = {
  top: number;
  left: number;
  size: number;
  color: string;      // rgb triplet, e.g. "99, 102, 241"
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  peak: number;       // peak opacity (0–1)
};

// Cold / cosmic palette — greens, blues, purples, indigo, cyan, magenta.
// Blobs overlap so hues blend softly into the nebula.
const BLOBS: Blob[] = [
  { top: 8,  left: 12, size: 520, color: "99, 102, 241",  duration: 72,  delay: 0,  driftX:  80, driftY: -50, peak: 0.38 }, // violet
  { top: 22, left: 68, size: 480, color: "96, 165, 250",  duration: 88,  delay: 11, driftX: -70, driftY:  60, peak: 0.32 }, // blue
  { top: 55, left: 18, size: 460, color: "52, 211, 153",  duration: 96,  delay: 22, driftX:  90, driftY:  40, peak: 0.26 }, // green
  { top: 68, left: 78, size: 540, color: "168, 85, 247",  duration: 80,  delay: 6,  driftX: -60, driftY: -70, peak: 0.34 }, // purple
  { top: 2,  left: 50, size: 420, color: "34, 211, 238",  duration: 104, delay: 16, driftX:  50, driftY:  80, peak: 0.24 }, // cyan
  { top: 82, left: 38, size: 400, color: "129, 140, 248", duration: 78,  delay: 27, driftX: -80, driftY: -40, peak: 0.30 }, // indigo
  { top: 38, left: 2,  size: 440, color: "217, 70, 239",  duration: 92,  delay: 9,  driftX: 100, driftY:  50, peak: 0.22 }, // magenta
  { top: 48, left: 55, size: 380, color: "45, 212, 191",  duration: 112, delay: 19, driftX: -40, driftY:  70, peak: 0.28 }, // teal
  { top: 15, left: 88, size: 360, color: "139, 92, 246",  duration: 86,  delay: 3,  driftX: -90, driftY:  30, peak: 0.30 }, // deep violet
];

export default function NebulaField() {
  return (
    <div className="sd-nebula-field" aria-hidden="true">
      {BLOBS.map((b, i) => (
        <span
          key={i}
          className="sd-nebula-blob"
          style={{
            top: `${b.top}%`,
            left: `${b.left}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            animationDuration: `${b.duration}s`,
            animationDelay: `-${b.delay}s`,
            ["--sd-blob-color" as string]: b.color,
            ["--sd-blob-peak" as string]: b.peak * OPACITY_SCALE,
            ["--sd-blob-drift-x" as string]: `${b.driftX}px`,
            ["--sd-blob-drift-y" as string]: `${b.driftY}px`,
          }}
        />
      ))}
    </div>
  );
}
