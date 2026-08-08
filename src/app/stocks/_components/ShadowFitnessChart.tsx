/**
 * Server-rendered fitness / NAV chart for the paper books.
 * Snapshots arrive newest-first; we plot oldest → newest.
 */

type Snapshot = {
  session: string | null;
  nav: number | null;
  windowFitness: number | null;
  fitnessIncrement: number | null;
  maxDrawdown: number | null;
};

type Props = {
  snapshots: Snapshot[];
};

function niceRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    // Fractions near 0 need a small pad; NAV-scale values need a dollar pad.
    const pad = Math.abs(min) < 1 ? 0.01 : Math.max(Math.abs(min) * 0.02, 1);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function dataExtent(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

function polyline(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function ShadowFitnessChart({ snapshots }: Props) {
  const chronological = [...snapshots].reverse().filter((s) => s.session);
  if (chronological.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-md bg-gray-50">
        {chronological.length === 0
          ? "No fitness snapshots yet — the nightly tick writes these after marks land."
          : "Need at least two sessions to draw a chart."}
      </div>
    );
  }

  const W = 720;
  const H = 220;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const navs = chronological.map((s) => s.nav).filter((n): n is number => n !== null);
  const fits = chronological
    .map((s) => s.windowFitness)
    .filter((n): n is number => n !== null);
  const navRange = niceRange(navs.length ? navs : [100_000]);
  const fitRange = niceRange(fits.length ? fits : [0]);
  const navExtent = dataExtent(navs.length ? navs : [100_000]);
  const fitExtent = dataExtent(fits.length ? fits : [0]);
  const hasFit = fits.length > 0;

  const xAt = (i: number) =>
    padL + (chronological.length === 1 ? innerW / 2 : (i / (chronological.length - 1)) * innerW);
  const yNav = (v: number) =>
    padT + ((navRange.max - v) / (navRange.max - navRange.min || 1)) * innerH;
  const yFit = (v: number) =>
    padT + ((fitRange.max - v) / (fitRange.max - fitRange.min || 1)) * innerH;

  const navPts = chronological
    .map((s, i) => (s.nav === null ? null : { x: xAt(i), y: yNav(s.nav) }))
    .filter((p): p is { x: number; y: number } => p !== null);
  const fitPts = chronological
    .map((s, i) =>
      s.windowFitness === null ? null : { x: xAt(i), y: yFit(s.windowFitness) },
    )
    .filter((p): p is { x: number; y: number } => p !== null);

  const area =
    navPts.length > 0
      ? [
          `M ${navPts[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)}`,
          ...navPts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
          `L ${navPts[navPts.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)}`,
          "Z",
        ].join(" ")
      : "";

  const labelIdx = [
    0,
    Math.floor((chronological.length - 1) / 2),
    chronological.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i);

  const zeroFitY = hasFit && fitRange.min < 0 && fitRange.max > 0 ? yFit(0) : null;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[520px] h-auto"
        role="img"
        aria-label="Shadow book NAV and window fitness over sessions"
      >
        <rect x={0} y={0} width={W} height={H} fill="transparent" />

        {area ? <path d={area} fill="#e5e7eb" opacity={0.7} /> : null}
        {navPts.length > 1 ? (
          <polyline
            fill="none"
            stroke="#111827"
            strokeWidth={2}
            points={polyline(navPts)}
          />
        ) : null}

        {zeroFitY !== null ? (
          <line
            x1={padL}
            x2={W - padR}
            y1={zeroFitY}
            y2={zeroFitY}
            stroke="#d1d5db"
            strokeDasharray="4 4"
          />
        ) : null}
        {fitPts.length > 1 ? (
          <polyline
            fill="none"
            stroke="#059669"
            strokeWidth={2}
            points={polyline(fitPts)}
          />
        ) : null}

        <text x={padL} y={padT + 10} fill="#9ca3af" fontSize={10}>
          NAV {navExtent.max.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </text>
        <text x={padL} y={padT + innerH} fill="#9ca3af" fontSize={10}>
          NAV {navExtent.min.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </text>
        {hasFit ? (
          <>
            <text
              x={W - padR}
              y={padT + 10}
              textAnchor="end"
              fill="#047857"
              fontSize={10}
            >
              Fit {(fitExtent.max * 100).toFixed(1)}%
            </text>
            <text
              x={W - padR}
              y={padT + innerH}
              textAnchor="end"
              fill="#047857"
              fontSize={10}
            >
              Fit {(fitExtent.min * 100).toFixed(1)}%
            </text>
          </>
        ) : null}

        {labelIdx.map((i) => (
          <text
            key={`${chronological[i].session}-${i}`}
            x={xAt(i)}
            y={H - 10}
            textAnchor={i === 0 ? "start" : i === chronological.length - 1 ? "end" : "middle"}
            fill="#6b7280"
            fontSize={10}
          >
            {chronological[i].session}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-gray-900" /> Paper NAV
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-emerald-600" /> Window fitness (fraction)
        </span>
        {!hasFit ? (
          <span className="text-amber-700">Window fitness not scored yet on these sessions.</span>
        ) : null}
      </div>
    </div>
  );
}
