import { fmtMoney } from "@/lib/stocks/format";

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
  sublabel?: string;
};

type Props = {
  segments: DonutSegment[];
  /** Total to show in the center; defaults to sum of segments. */
  centerValue?: number;
  centerLabel?: string;
  size?: number;
  thickness?: number;
};

/**
 * Server-rendered SVG donut. No client JS, no chart deps.
 * Segments are drawn clockwise starting at 12 o'clock.
 */
export function DonutChart({
  segments,
  centerValue,
  centerLabel = "Total",
  size = 180,
  thickness = 28,
}: Props) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const display = centerValue ?? total;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
        role="img"
        aria-label="Donut chart"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#f3f4f6"
          strokeWidth={thickness}
        />
        {total > 0 &&
          segments.map((seg, i) => {
            const v = Math.max(0, seg.value);
            if (v === 0) return null;
            const len = (v / total) * c;
            const dasharray = `${len} ${c - len}`;
            const el = (
              <circle
                key={`${seg.label}-${i}`}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={dasharray}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
            offset += len;
            return el;
          })}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-gray-500"
          fontSize="10"
        >
          {centerLabel}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          className="fill-gray-900"
          fontSize="14"
          fontWeight={600}
        >
          {fmtMoney(display)}
        </text>
      </svg>
      <ul className="flex-1 w-full text-sm space-y-1.5">
        {segments.length === 0 && (
          <li className="text-gray-500 text-sm">No data.</li>
        )}
        {segments.map((seg, i) => {
          const pct = total > 0 ? (seg.value / total) * 100 : 0;
          return (
            <li
              key={`${seg.label}-${i}`}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="truncate">
                  <span className="font-medium">{seg.label}</span>
                  {seg.sublabel && (
                    <span className="text-gray-500"> · {seg.sublabel}</span>
                  )}
                </span>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div>{fmtMoney(seg.value)}</div>
                <div className="text-xs text-gray-500">{pct.toFixed(1)}%</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
