/**
 * Two paper books, NAV rebased to 100 at test start. Custom SVG, no chart library.
 */
import { fmtDayMonth } from "@/lib/shadow/summaryMath";

export type ShadowBookSeries = {
  label: string;
  color: string;
  points: Array<{ session: string; value: number }>;
};

type Props = {
  current: ShadowBookSeries;
  challenger: ShadowBookSeries;
};

function niceRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 99, max: 101 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.02, 1);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function polyline(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function ShadowBooksChart({ current, challenger }: Props) {
  const sessions = [
    ...new Set([
      ...current.points.map((p) => p.session),
      ...challenger.points.map((p) => p.session),
    ]),
  ].sort();

  if (sessions.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-md bg-gray-50">
        Need at least two trading days to draw this chart.
      </div>
    );
  }

  const W = 720;
  const H = 220;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = [...current.points, ...challenger.points].map((p) => p.value);
  const range = niceRange(values.length ? values : [100]);
  const xAt = (i: number) =>
    padL + (sessions.length === 1 ? innerW / 2 : (i / (sessions.length - 1)) * innerW);
  const yAt = (v: number) =>
    padT + ((range.max - v) / (range.max - range.min || 1)) * innerH;

  const linePts = (series: ShadowBookSeries) =>
    series.points
      .map((p) => {
        const i = sessions.indexOf(p.session);
        if (i < 0) return null;
        return { x: xAt(i), y: yAt(p.value) };
      })
      .filter((p): p is { x: number; y: number } => p !== null);

  const currentPts = linePts(current);
  const challengerPts = linePts(challenger);

  const labelIdx = [0, Math.floor((sessions.length - 1) / 2), sessions.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  const hundredY = range.min < 100 && range.max > 100 ? yAt(100) : null;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[520px] h-auto"
        role="img"
        aria-label="Both paper books since the test started, rebased to 100"
      >
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
        {hundredY !== null ? (
          <line
            x1={padL}
            x2={W - padR}
            y1={hundredY}
            y2={hundredY}
            stroke="#e5e7eb"
            strokeDasharray="4 4"
          />
        ) : null}
        {currentPts.length > 1 ? (
          <polyline
            fill="none"
            stroke={current.color}
            strokeWidth={2}
            points={polyline(currentPts)}
          />
        ) : null}
        {challengerPts.length > 1 ? (
          <polyline
            fill="none"
            stroke={challenger.color}
            strokeWidth={2}
            points={polyline(challengerPts)}
          />
        ) : null}
        <text x={padL} y={padT + 10} fill="#9ca3af" fontSize={10}>
          {range.max.toFixed(0)}
        </text>
        <text x={padL} y={padT + innerH} fill="#9ca3af" fontSize={10}>
          {range.min.toFixed(0)}
        </text>
        {labelIdx.map((i) => (
          <text
            key={`${sessions[i]}-${i}`}
            x={xAt(i)}
            y={H - 10}
            textAnchor={i === 0 ? "start" : i === sessions.length - 1 ? "end" : "middle"}
            fill="#6b7280"
            fontSize={10}
          >
            {fmtDayMonth(sessions[i]!)}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ background: current.color }} />
          {current.label}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5" style={{ background: challenger.color }} />
          {challenger.label}
        </span>
      </div>
    </div>
  );
}
