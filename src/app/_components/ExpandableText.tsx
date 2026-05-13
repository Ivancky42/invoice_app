"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders text clamped to `lines` rows by default with a "Read more" toggle
 * that appears only when the content actually overflows. Detection is done
 * by comparing scrollHeight to clientHeight while collapsed, so short
 * strings never get a useless toggle.
 */
export function ExpandableText({
  text,
  lines = 3,
  className,
  textClassName = "whitespace-pre-wrap",
  toggleClassName = "text-xs text-gray-600 hover:text-gray-900 hover:underline mt-1",
}: {
  text: string;
  lines?: number;
  className?: string;
  textClassName?: string;
  toggleClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [text, lines, expanded]);

  const clampStyle = !expanded
    ? ({
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      } as React.CSSProperties)
    : undefined;

  const showToggle = overflows || expanded;

  return (
    <div className={className}>
      <p ref={ref} style={clampStyle} className={textClassName}>
        {text}
      </p>
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={toggleClassName}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
