/**
 * The treatment-category icons — the same drawings the app shows beside each category on
 * its treatment tabs (Zennara App/components/treatments/TreatmentCategoryIcon.tsx). A
 * category stores only the key; change a drawing in both places together.
 */
type Shape = { d: string } | { c: [number, number, number] };

const FACE = "M12 3.25c3.75 0 6.25 2.9 6.25 7.1 0 5.15-3.1 9.4-6.25 10.4-3.15-1-6.25-5.25-6.25-10.4 0-4.2 2.5-7.1 6.25-7.1Z";
/** A four-point sparkle centred on (x, y): tips at radius r, waist at k·r. */
const SPARKLE = (x: number, y: number, r: number, k = 0.3) => {
  const n = (v: number) => +v.toFixed(2);
  const i = k * r;
  return `M${n(x)} ${n(y - r)}L${n(x + i)} ${n(y - i)}L${n(x + r)} ${n(y)}L${n(x + i)} ${n(y + i)}L${n(x)} ${n(y + r)}L${n(x - i)} ${n(y + i)}L${n(x - r)} ${n(y)}L${n(x - i)} ${n(y - i)}Z`;
};

const ICONS: Record<string, Shape[]> = {
  "laser-hair-reduction": [
    { d: "M6.25 4.5h7a1.25 1.25 0 0 1 1.25 1.25v2A1.25 1.25 0 0 1 13.25 9h-7A1.25 1.25 0 0 1 5 7.75v-2A1.25 1.25 0 0 1 6.25 4.5Z" },
    { d: "M14.5 6.75h2a2.75 2.75 0 0 0 2.75-2.75V2.75" },
    { d: "M7.25 9 5.75 13M9.75 9v4M12.25 9l1.5 4" },
    { d: "M3 17.25c2.25-1.3 4.5-1.3 6.75 0s4.5 1.3 6.75 0 3.4-1.1 4.5-.6" },
    { d: "M4.75 16.6v-2.1M19.25 16.7v-2.45" },
  ],
  "hair-regrowth": [
    { d: "M3 14h18" },
    { d: "M10.4 14v2.4c0 1-.8 1.6-.8 2.6a2.4 2.4 0 0 0 4.8 0c0-1-.8-1.6-.8-2.6V14" },
    { d: "M12 14V8c0-2.2 1.3-3.9 3.6-4.7" },
    { d: "M12 10.4c-1.9 0-3.2-1-3.5-2.9 1.9 0 3.2 1 3.5 2.9Z" },
  ],
  "acne-scar": [
    { d: FACE },
    { c: [9.4, 10, 0.75] },
    { c: [14.4, 11.4, 0.75] },
    { c: [10.6, 14.6, 0.6] },
    { d: "M13.4 15.6l1.3.8" },
  ],
  "skin-rejuvenation": [
    { d: "M3 15.5c3-1.4 6-1.4 9 0s6 1.4 9 0" },
    { d: "M3 19.5c3-1.4 6-1.4 9 0s6 1.4 9 0" },
    { d: SPARKLE(11, 7, 3.6) },
    { d: SPARKLE(17.5, 8.6, 1.8) },
  ],
  "insta-glow": [
    { c: [12, 12, 4.75] },
    { d: "M12 3v1.75M12 19.25V21M3 12h1.75M19.25 12H21M5.65 5.65l1.25 1.25M17.1 17.1l1.25 1.25M18.35 5.65 17.1 6.9M6.9 17.1l-1.25 1.25" },
    { d: "M10.1 13.1c.5.55 1.15.85 1.9.85s1.4-.3 1.9-.85" },
    { d: "M10.2 10.5v.4M13.8 10.5v.4" },
  ],
  pigmentation: [
    { d: FACE },
    { d: "M8.7 9.3c.7-.5 1.8-.3 2 .5.2.8-.5 1.4-1.3 1.4-.9 0-1.4-1.3-.7-1.9Z" },
    { d: "M13.5 13.2c.8-.35 1.8.1 1.75.95-.05.75-.95 1.15-1.7.85-.85-.3-.9-1.45-.05-1.8Z" },
    { c: [14.6, 9.2, 0.55] },
  ],
  "anti-aging": [
    { d: "M3 18.25c3-1.4 6-1.4 9 0s6 1.4 9 0" },
    { d: "M8 14.5V6.75M5.75 9 8 6.75 10.25 9" },
    { d: "M16 14.5V6.75M13.75 9 16 6.75 18.25 9" },
    { d: SPARKLE(12, 4.25, 1.6) },
  ],
  more: [
    { c: [12, 12.25, 4.1] },
    { c: [12, 5.6, 1.55] },
    { d: "M5.25 21c.85-2.4 3.5-3.75 6.75-3.75s5.9 1.35 6.75 3.75" },
    { d: SPARKLE(19, 7.25, 1.6) },
  ],
  body: [
    { d: "M8.5 3c.3 2.6-.2 4.3-1.1 5.8-.9 1.6-1 3.2-.3 4.9.7 1.8.8 3.9.1 7.3" },
    { d: "M15.5 3c-.3 2.6.2 4.3 1.1 5.8.9 1.6 1 3.2.3 4.9-.7 1.8-.8 3.9-.1 7.3" },
    { d: "M8.1 11.9h7.8" },
    { c: [12, 14.3, 0.5] },
  ],
};

/** Keys the backend accepts (utils/treatmentTaxonomy ICON_KEYS), with a label for the picker. */
export const TREATMENT_ICON_OPTIONS: [string, string][] = [
  ["laser-hair-reduction", "Laser"],
  ["hair-regrowth", "Hair"],
  ["acne-scar", "Acne"],
  ["skin-rejuvenation", "Renewal"],
  ["insta-glow", "Glow"],
  ["pigmentation", "Pigment"],
  ["anti-aging", "Lift"],
  ["more", "Care"],
  ["body", "Body"],
];

/** The conditions a treatment can list — used when the API is older than /consultations/taxonomy. */
export const TREATMENT_CONDITIONS_FALLBACK: [string, string][] = [
  ["acne-vulgaris", "Acne Vulgaris"],
  ["acne-scar", "Acne Scar"],
  ["ageing-issues", "Ageing Issues"],
  ["birth-marks", "Birth Marks"],
  ["dark-circles", "Dark Circles"],
  ["hypertrichosis", "Hypertrichosis"],
  ["hair-loss", "Hair Loss"],
  ["moles", "Moles"],
  ["open-pores", "Open Pores"],
  ["skin-pigmentation", "Skin Pigmentation"],
  ["skin-tags", "Skin Tags"],
  ["stretch-marks", "Stretch Marks"],
  ["tanned-skin", "Tanned Skin"],
];

export const hasTreatmentIcon = (name?: string | null) => !!name && name in ICONS;

export function TreatmentIcon({ name, size = 20, className = "", strokeWidth = 1.4 }: { name?: string | null; size?: number; className?: string; strokeWidth?: number }) {
  const shapes = (name && ICONS[name]) || [{ d: SPARKLE(12, 12, 7) }];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {shapes.map((s, i) =>
        "d" in s
          ? <path key={i} d={s.d} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          : <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} stroke="currentColor" strokeWidth={strokeWidth} fill="none" />
      )}
    </svg>
  );
}
