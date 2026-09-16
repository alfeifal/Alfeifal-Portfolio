"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { Reveal, DUR } from "@/components/motion";

const A = "rgb(var(--accent))", B = "rgb(var(--negative))", C = "rgb(var(--positive))";
const tooltipStyle = { background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))", borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px -8px rgb(0 0 0 / 0.25)", padding: "8px 10px" } as const;
const cursor = { fill: "rgb(var(--fg) / 0.04)" } as const;
const ANIM = DUR.slow * 1000 + 250; // progressive reveal on mount and on data/timeframe changes

/** Grouped bars (two series) — income vs expenses, volume per week, etc. Wrapped in a scroll-reveal fade. */
export function MiniBars({ series, labels, format, height = 180 }: { series: { label: string; a: number; b?: number }[]; labels: [string, string?]; format?: (v: number) => string; height?: number }) {
  if (!series.length) return <p className="text-sm muted">No data.</p>;
  return (
    <Reveal>
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={series} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} width={40} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => (format ? format(Number(v)) : String(v))} contentStyle={tooltipStyle} cursor={cursor} />
            {labels[1] && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Bar dataKey="a" name={labels[0]} fill={C} radius={[4, 4, 0, 0]} animationDuration={ANIM} animationEasing="ease-out" />
            {labels[1] && <Bar dataKey="b" name={labels[1]} fill={B} radius={[4, 4, 0, 0]} animationDuration={ANIM} animationEasing="ease-out" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Reveal>
  );
}
export function MiniLine({ series, label, format, height = 180, domain }: { series: { label: string; v: number }[]; label: string; format?: (v: number) => string; height?: number; domain?: [number, number] }) {
  if (!series.length) return <p className="text-sm muted">No data.</p>;
  return (
    <Reveal>
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} width={40} axisLine={false} tickLine={false} domain={domain} />
            <Tooltip formatter={(v) => (format ? format(Number(v)) : String(v))} contentStyle={tooltipStyle} cursor={{ stroke: "rgb(var(--fg) / 0.2)", strokeDasharray: "3 3" }} />
            <Line type="monotone" dataKey="v" name={label} stroke={A} strokeWidth={2} dot={series.length < 40 ? { r: 2.5, strokeWidth: 0, fill: A } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--surface))" }} animationDuration={ANIM} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Reveal>
  );
}
