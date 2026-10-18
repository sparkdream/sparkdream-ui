// Global multiplier for shimmer peak opacity. Lower = fainter shimmer.
const SHIMMER_OPACITY_SCALE = 1.0;

type Shimmer = {
  size: number; // px, diameter of the lit pool
  from: string; // mask-position at the start of the drift
  to: string; // mask-position at the end of the drift
  tint: string; // rgb triplet
  duration: number;
  delay: number;
  peak: number;
};

// Verdigris palette: mint, teal, a touch of aged-copper green. Each pool is a
// soft mask over a brighter copy of the dot grid, drifting slowly so the grid
// seems to catch the light like a struck coin turned in the hand. Authored
// (not random) so SSR and client markup match.
const SHIMMERS: Shimmer[] = [
  { size: 620, from: "8% 12%",  to: "62% 38%", tint: "143, 230, 204", duration: 70, delay: 0,  peak: 0.32 }, // mint
  { size: 540, from: "92% 30%", to: "40% 82%", tint: "52, 196, 164",  duration: 84, delay: 18, peak: 0.36 }, // verdigris
  { size: 480, from: "30% 96%", to: "86% 56%", tint: "120, 214, 176", duration: 92, delay: 40, peak: 0.28 }, // patina green
  { size: 420, from: "70% 4%",  to: "14% 60%", tint: "196, 245, 228", duration: 64, delay: 27, peak: 0.24 }, // pale glint
];

export default function PatinaField() {
  return (
    <div className="sd-patina-field" aria-hidden="true">
      <span className="sd-patina-grid" />
      {SHIMMERS.map((s, i) => (
        <span
          key={i}
          className="sd-patina-shimmer"
          style={{
            ["--sd-patina-size" as string]: `${s.size}px`,
            ["--sd-patina-from" as string]: s.from,
            ["--sd-patina-to" as string]: s.to,
            ["--sd-patina-tint" as string]: s.tint,
            ["--sd-patina-dur" as string]: `${s.duration}s`,
            ["--sd-patina-delay" as string]: `-${s.delay}s`,
            ["--sd-patina-peak" as string]: s.peak * SHIMMER_OPACITY_SCALE,
          }}
        />
      ))}
    </div>
  );
}
