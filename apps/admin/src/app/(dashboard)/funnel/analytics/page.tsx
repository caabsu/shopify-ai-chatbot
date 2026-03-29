'use client';

import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const ACCENT = '#10b981';

const DATE_RANGES = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

interface DailyRow {
  date: string;
  total: number;
  completed: number;
  converted: number;
  reveal: number;
  styleProfile: number;
}

interface ComparisonRow {
  concept: string;
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  conversions: number;
  conversionRate: number;
}

interface FunnelStep {
  step: string;
  count: number;
}

interface ProfileRow {
  key: string;
  name: string;
  count: number;
}

interface DurationRow {
  step: string;
  avgDurationSec: number;
  sampleSize: number;
}

interface DeviceRow {
  device: string;
  count: number;
  percentage: number;
}

interface UtmRow {
  source: string;
  sessions: number;
  completions: number;
  conversionRate: number;
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

const tooltipStyle = {
  backgroundColor: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: '8px',
  color: 'var(--text-primary)',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: 'var(--shadow-sm)',
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyState({ height = 300 }: { height?: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>No data yet</p>
    </div>
  );
}

export default function FunnelAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [durations, setDurations] = useState<DurationRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [utm, setUtm] = useState<UtmRow[]>([]);

  useEffect(() => {
    setLoading(true);
    const q = `days=${days}`;
    Promise.all([
      fetch(`${API}/api/quiz/analytics/daily?${q}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/quiz/analytics/comparison?${q}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/quiz/analytics/funnel?${q}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/quiz/analytics/profiles?${q}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/quiz/analytics/durations?${q}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/quiz/analytics/devices?${q}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/quiz/analytics/utm?${q}`).then((r) => r.json()).catch(() => []),
    ]).then(([dailyData, compData, funnelData, profileData, durationData, deviceData, utmData]) => {
      setDaily(Array.isArray(dailyData) ? dailyData : []);
      setComparison(Array.isArray(compData) ? compData : []);
      setFunnel(Array.isArray(funnelData) ? funnelData : []);
      setProfiles(Array.isArray(profileData) ? profileData : []);
      setDurations(Array.isArray(durationData) ? durationData : []);
      setDevices(Array.isArray(deviceData) ? deviceData : []);
      setUtm(Array.isArray(utmData) ? utmData : []);
      setLoading(false);
    });
  }, [days]);

  /* ---------- Loading skeleton ---------- */
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div
          style={{
            height: '32px',
            width: '160px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-tertiary)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            style={{
              height: '320px',
              borderRadius: '12px',
              backgroundColor: 'var(--bg-tertiary)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ))}
      </div>
    );
  }

  /* ---------- Determine A/B winner ---------- */
  const winner =
    comparison.length === 2
      ? (comparison[0].conversionRate ?? 0) >= (comparison[1].conversionRate ?? 0)
        ? comparison[0].concept
        : comparison[1].concept
      : null;

  const maxFunnelCount = funnel.length > 0 ? Math.max(...funnel.map((f) => f.count)) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ===== Header ===== */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Analytics
        </h2>
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '4px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          {DATE_RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
                backgroundColor: days === r.days ? 'var(--bg-primary)' : 'transparent',
                color: days === r.days ? 'var(--text-primary)' : 'var(--text-tertiary)',
                boxShadow: days === r.days ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Daily Sessions Chart ===== */}
      <ChartCard title="Daily Sessions">
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey="total" stroke="#9ca3af" strokeWidth={2} dot={false} name="Total" />
              <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} dot={false} name="Completed" />
              <Line type="monotone" dataKey="converted" stroke={ACCENT} strokeWidth={2} dot={false} name="Converted" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState />
        )}
      </ChartCard>

      {/* ===== A/B Comparison ===== */}
      {comparison.length > 0 && (
        <ChartCard title="A/B Comparison">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {comparison.map((c) => {
              const isWinner = c.concept === winner;
              return (
                <div
                  key={c.concept}
                  style={{
                    padding: '20px',
                    borderRadius: '10px',
                    border: isWinner ? `2px solid ${ACCENT}` : '1px solid var(--border-primary)',
                    backgroundColor: isWinner ? `${ACCENT}08` : 'var(--bg-secondary)',
                    position: 'relative',
                  }}
                >
                  {isWinner && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '12px',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: ACCENT,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Winner
                    </span>
                  )}
                  <h4
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      margin: '0 0 16px 0',
                    }}
                  >
                    {c.concept}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <Stat label="Sessions" value={String(c.totalSessions)} />
                    <Stat label="Completed" value={String(c.completedSessions)} />
                    <Stat label="Completion Rate" value={`${(c.completionRate ?? 0).toFixed(1)}%`} />
                    <Stat
                      label="Conversion Rate"
                      value={`${(c.conversionRate ?? 0).toFixed(1)}%`}
                      highlight={isWinner}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}

      {/* ===== Step Funnel ===== */}
      <ChartCard title="Step Funnel">
        {funnel.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(200, funnel.length * 44)}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} allowDecimals={false} />
              <YAxis
                dataKey="step"
                type="category"
                width={120}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} name="Sessions">
                {funnel.map((entry, i) => {
                  const opacity = maxFunnelCount > 0 ? 0.4 + 0.6 * (entry.count / maxFunnelCount) : 1;
                  return (
                    <rect key={i} fill={ACCENT} fillOpacity={opacity} />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState />
        )}
      </ChartCard>

      {/* ===== Profile Distribution ===== */}
      <ChartCard title="Profile Distribution">
        {profiles.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(200, profiles.length * 44)}>
            <BarChart data={profiles} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} allowDecimals={false} />
              <YAxis
                dataKey="name"
                type="category"
                width={140}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} name="Profiles" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState />
        )}
      </ChartCard>

      {/* ===== Step Durations ===== */}
      <ChartCard title="Step Durations">
        {durations.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={durations} margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
              <XAxis
                dataKey="step"
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                label={{
                  value: 'seconds',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 11, fill: 'var(--text-tertiary)' },
                }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, _name: string, props: { payload?: DurationRow }) => [
                  `${(value ?? 0).toFixed(1)}s${props.payload ? ` (n=${props.payload.sampleSize})` : ''}`,
                  'Avg Duration',
                ]}
              />
              <Bar dataKey="avgDurationSec" fill={ACCENT} radius={[4, 4, 0, 0]} name="Avg Duration (s)" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState />
        )}
      </ChartCard>

      {/* ===== Device & UTM ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Device Breakdown */}
        <ChartCard title="Device Breakdown">
          {devices.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Device', 'Sessions', '%'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === 'Device' ? 'left' : 'right',
                        padding: '8px 12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '1px solid var(--border-primary)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.device}>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {d.device}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        textAlign: 'right',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {d.count}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        textAlign: 'right',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {(d.percentage ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState height={200} />
          )}
        </ChartCard>

        {/* UTM Sources */}
        <ChartCard title="UTM Sources">
          {utm.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Source', 'Sessions', 'Completions', 'Conv %'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === 'Source' ? 'left' : 'right',
                        padding: '8px 12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '1px solid var(--border-primary)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {utm.map((u) => (
                  <tr key={u.source}>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {u.source}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        textAlign: 'right',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {u.sessions}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        textAlign: 'right',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {u.completions}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: ACCENT,
                        textAlign: 'right',
                        borderBottom: '1px solid var(--border-secondary)',
                      }}
                    >
                      {(u.conversionRate ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState height={200} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

/* ---------- Small helper component ---------- */

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: '10px',
          fontWeight: 500,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '0 0 4px 0',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: highlight ? ACCENT : 'var(--text-primary)',
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}
