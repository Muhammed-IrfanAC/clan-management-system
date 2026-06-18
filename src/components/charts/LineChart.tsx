'use client';

import { useRef, useState } from 'react';

export type ChartSeries = {
  label: string;
  color: string;
  points: { x: string; y: number }[];
  /** Render as a dashed reference line (used to distinguish series without relying on color). */
  dashed?: boolean;
  /** Fill the area under the line. */
  fill?: boolean;
};

type Props = {
  series: ChartSeries[];
  /** Short sentence describing the chart's key insight (for screen readers). */
  ariaSummary?: string;
  /** Granularity label shown on the x-axis, e.g. "Weekly". */
  granularityLabel?: string;
  height?: number;
};

// SVG user-space geometry. The element scales to its container via viewBox.
const W = 820;
const PAD = { left: 44, right: 18, top: 18, bottom: 36 };

function niceStep(v: number) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

export default function LineChart({ series, ariaSummary, granularityLabel, height = 280 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const labels = series[0]?.points.map(p => p.x) ?? [];
  const n = labels.length;

  const rawMax = Math.max(1, ...series.flatMap(s => s.points.map(p => p.y)));
  const step = niceStep(rawMax / 4);
  const yMax = step * 4;
  const ticks = [0, step, step * 2, step * 3, step * 4];

  const xAt = (i: number) => (n <= 1 ? PAD.left + plotW / 2 : PAD.left + (plotW * i) / (n - 1));
  const yAt = (v: number) => PAD.top + plotH * (1 - v / yMax);

  const labelEvery = Math.max(1, Math.ceil(n / 8));

  function handleMove(e: React.PointerEvent) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((relX - PAD.left) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const isEmpty = n === 0 || series.every(s => s.points.every(p => p.y === 0));

  if (isEmpty) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: height, gap: 'var(--space-sm)', textAlign: 'center' }}>
        <p className="text-muted" style={{ margin: 0 }}>No leadership activity recorded yet.</p>
        <p className="text-muted" style={{ margin: 0, fontSize: '0.8rem', opacity: 0.7 }}>Log a warning or a leadership note to start tracking performance.</p>
      </div>
    );
  }

  // Tooltip box geometry (rendered inside the SVG so it scales with the chart).
  const tipRows = hover !== null ? series : [];
  const tipW = 168;
  const tipH = 24 + tipRows.length * 17;
  const tipX = hover !== null && xAt(hover) + 14 + tipW > W - PAD.right ? xAt(hover) - 14 - tipW : (hover !== null ? xAt(hover) + 14 : 0);

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={ariaSummary || 'Leadership performance over time'}
        style={{ display: 'block', touchAction: 'none' }}
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Horizontal gridlines + y-axis labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yAt(t)} y2={yAt(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yAt(t) + 4} textAnchor="end" fontSize={11} fill="rgba(148,163,184,0.8)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t}
            </text>
          </g>
        ))}

        {/* X-axis labels (auto-skipped) */}
        {labels.map((lab, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={xAt(i)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="rgba(148,163,184,0.8)">
              {lab}
            </text>
          ) : null
        )}

        {/* Series: area fills first, then lines, then dots */}
        {series.map((s, si) => {
          const pts = s.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(' ');
          const areaPts = `${PAD.left},${yAt(0)} ${pts} ${xAt(n - 1)},${yAt(0)}`;
          return (
            <g key={`area-${si}`}>
              {s.fill && <polygon points={areaPts} fill={s.color} opacity={0.12} />}
            </g>
          );
        })}
        {series.map((s, si) => {
          const pts = s.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(' ');
          return (
            <polyline
              key={`line-${si}`}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? '6 5' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {series.map((s, si) =>
          s.points.map((p, i) => (
            <circle
              key={`dot-${si}-${i}`}
              cx={xAt(i)}
              cy={yAt(p.y)}
              r={hover === i ? 4.5 : 2.5}
              fill={hover === i ? s.color : 'var(--color-background, #020617)'}
              stroke={s.color}
              strokeWidth={2}
            />
          ))
        )}

        {/* Hover guide + tooltip */}
        {hover !== null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3 3" />
            <rect x={tipX} y={PAD.top} width={tipW} height={tipH} rx={6} fill="#0b1220" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            <text x={tipX + 10} y={PAD.top + 16} fontSize={11} fontWeight={700} fill="#F8FAFC">
              {labels[hover]}
            </text>
            {tipRows.map((s, ri) => (
              <g key={ri} transform={`translate(${tipX + 10}, ${PAD.top + 24 + ri * 17})`}>
                <rect x={0} y={4} width={9} height={9} rx={2} fill={s.color} />
                <text x={15} y={12} fontSize={11} fill="rgba(226,232,240,0.95)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {s.label}: {s.points[hover]?.y ?? 0}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>

      {/* Footer: granularity + accessible data-table toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-sm)' }}>
        <span className="text-muted" style={{ fontSize: '0.7rem' }}>{granularityLabel ? `${granularityLabel} buckets` : ''}</span>
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          className="text-muted"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.7rem', textDecoration: 'underline' }}
          aria-expanded={showTable}
        >
          {showTable ? 'Hide data table' : 'Show data table'}
        </button>
      </div>

      {showTable && (
        <div style={{ overflowX: 'auto', marginTop: 'var(--space-sm)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-muted)' }}>Period</th>
                {series.map((s, i) => (
                  <th key={i} style={{ textAlign: 'right', padding: '4px 8px', color: s.color }}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((lab, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '4px 8px' }}>{lab}</td>
                  {series.map((s, si) => (
                    <td key={si} style={{ textAlign: 'right', padding: '4px 8px', fontVariantNumeric: 'tabular-nums' }}>{s.points[i]?.y ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
