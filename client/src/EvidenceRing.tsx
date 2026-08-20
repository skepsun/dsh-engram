/**
 * dsh-engram: evidence-progress ring.
 *
 * Compact SVG donut with three arc segments — the three esr_close evidence
 * gates (artifact · evaluation · memory_ref). Filled segments are colored by
 * overall completion (green when all three are present, amber while partial),
 * missing segments leave a faint track. Pure SVG, no chart dependency, so the
 * bundle stays clean; used on ESR task cards and aggregate gauges.
 */

interface EvidenceRingFace {
  artifact: boolean;
  evaluation: boolean;
  refs: boolean;
  /** Pixel diameter. 24 for cards, larger for gauges. */
  size?: number;
  /** Render a "n/3" counter in the centre (auto when size >= 28). */
  showLabel?: boolean;
  /** Tooltip describing the gates. */
  title?: string;
  /** 0..1 single-arc progress (aggregate gauges); overrides the three gates. */
  fraction?: number;
  /** Centre label override (default "n/3" or percentage for fraction). */
  labelText?: string;
}

export function EvidenceRing({ artifact, evaluation, refs, size = 24, showLabel = true, title, fraction, labelText }: EvidenceRingFace) {
  const filled = Number(artifact) + Number(evaluation) + Number(refs);
  const complete = fraction !== undefined ? fraction >= 1 : filled === 3;
  const partial = fraction !== undefined ? fraction > 0 : filled > 0 && filled < 3;
  const color = complete ? "#10b981" : partial ? "#f59e0b" : "#94a3b8";
  const track = "rgba(148,163,184,.22)";

  const sw = Math.max(2.5, Math.round(size * 0.16));
  const r = (size - sw) / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const gap = c * 0.05;
  const arc = (c - gap * 3) / 3;
  const cx = size / 2;
  const cy = size / 2;

  const isFraction = fraction !== undefined;
  const label = showLabel && size >= 28;
  const centerText =
    labelText ??
    (isFraction
      ? `${Math.round((fraction as number) * 100)}%`
      : `${filled}/3`);

  return (
    <span
      title={
        title ??
        (isFraction
          ? `证据完备度 ${Math.round((fraction as number) * 100)}%`
          : `证据闭环：artifact${artifact ? "✓" : "✗"} · evaluation${evaluation ? "✓" : "✗"} · memory_ref${refs ? "✓" : "✗"} (${filled}/3)`)
      }
      style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", width: size, height: size, lineHeight: 1 }}
    >
      {isFraction ? (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={track} strokeWidth={sw} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeDasharray={`${Math.max(0, Math.min(1, fraction as number)) * c} ${c}`}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {gates().map((g, i) => (
            <circle
              key={g.name}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={g.on ? color : track}
              strokeWidth={sw}
              strokeDasharray={`${arc} ${c - arc}`}
              transform={`rotate(${i * 120 - 90} ${cx} ${cy})`}
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}
      {label && (
        <span
          style={{
            position: "absolute",
            color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-strong, #374151))",
            fontSize: isFraction ? Math.max(8, Math.round(size * 0.26)) : Math.max(8, Math.round(size * 0.3)),
            fontWeight: 700,
          }}
        >
          {centerText}
        </span>
      )}
    </span>
  );

  function gates() {
    return [
      { on: Boolean(artifact), name: "artifact" },
      { on: Boolean(evaluation), name: "evaluation" },
      { on: Boolean(refs), name: "memory_ref" },
    ];
  }
}
