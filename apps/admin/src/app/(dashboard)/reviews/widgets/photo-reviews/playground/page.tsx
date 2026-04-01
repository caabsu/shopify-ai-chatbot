'use client';

import { useState } from 'react';
import { Star, ChevronLeft, ChevronRight, ArrowLeft, Verified, Quote, Heart, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const MOCK_REVIEWS = [
  {
    id: '1',
    author: 'Sarah M.',
    rating: 5,
    title: 'Absolutely stunning in our backyard',
    body: 'The Aven light transformed our outdoor space. The warm glow is perfect for evening dinners on the patio. Build quality is exceptional.',
    date: 'Mar 15, 2026',
    verified: true,
    product: 'Aven Path Light',
    variant: 'Brass / Warm White',
    image: null,
    helpful: 12,
  },
  {
    id: '2',
    author: 'James K.',
    rating: 5,
    title: 'Professional grade quality',
    body: 'Installed 8 of these along our walkway. The brass finish is gorgeous and they survived a harsh winter without any issues.',
    date: 'Feb 28, 2026',
    verified: true,
    product: 'Aven Path Light',
    variant: 'Brass / Daylight',
    image: null,
    helpful: 8,
  },
  {
    id: '3',
    author: 'Rachel T.',
    rating: 4,
    title: 'Beautiful design, easy install',
    body: 'Love the minimalist design. Took about 20 minutes to install each light. Only wish the cable was a bit longer.',
    date: 'Feb 10, 2026',
    verified: true,
    product: 'Aven Path Light',
    variant: 'Black / Warm White',
    image: null,
    helpful: 5,
  },
  {
    id: '4',
    author: 'David L.',
    rating: 5,
    title: 'Worth every penny',
    body: 'These lights elevated our entire landscape design. The warm brass tone complements our home perfectly. Highly recommend.',
    date: 'Jan 22, 2026',
    verified: true,
    product: 'Aven Path Light',
    variant: 'Brass / Warm White',
    image: null,
    helpful: 15,
  },
  {
    id: '5',
    author: 'Monica P.',
    rating: 5,
    title: 'Elegant and durable',
    body: 'Six months in and they still look brand new. The light output is perfect — not too bright, not too dim. Exactly what we wanted.',
    date: 'Jan 5, 2026',
    verified: true,
    product: 'Aven Path Light',
    variant: 'Black / Daylight',
    image: null,
    helpful: 7,
  },
  {
    id: '6',
    author: 'Tom H.',
    rating: 5,
    title: 'Our neighbors keep asking about these',
    body: 'Every time we have guests, someone asks where we got our path lights. The quality speaks for itself. Already ordered more for the front yard.',
    date: 'Dec 18, 2025',
    verified: true,
    product: 'Aven Path Light',
    variant: 'Brass / Warm White',
    image: null,
    helpful: 22,
  },
];

/* ------------------------------------------------------------------ */
/*  Brand constants                                                   */
/* ------------------------------------------------------------------ */

const GOLD = '#C5A059';
const DARK = '#2D3338';
const WARM_BG = '#F4F0EB';
const FONT = "'Manrope', system-ui, -apple-system, sans-serif";

/* ------------------------------------------------------------------ */
/*  Gradient palettes for placeholder images                          */
/* ------------------------------------------------------------------ */

const IMAGE_GRADIENTS = [
  'linear-gradient(135deg, #D4A846 0%, #8B6914 40%, #5C4A1E 70%, #2D2A1F 100%)',
  'linear-gradient(160deg, #C49A3C 0%, #A07B28 35%, #6B5420 65%, #3A3020 100%)',
  'linear-gradient(145deg, #E8C668 0%, #B8942E 30%, #7A6322 60%, #342E1C 100%)',
  'linear-gradient(130deg, #CFAA4F 0%, #9A7B2C 45%, #5E4B20 75%, #28241C 100%)',
  'linear-gradient(155deg, #DDB94E 0%, #A58830 40%, #6E5922 70%, #2F2B20 100%)',
  'linear-gradient(140deg, #C9A445 0%, #957428 35%, #634E1E 65%, #2A261C 100%)',
];

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                    */
/* ------------------------------------------------------------------ */

function Stars({ count, size = 14, color = GOLD }: { count: number; size?: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={size}
          fill={i < count ? color : 'transparent'}
          stroke={i < count ? color : 'rgba(255,255,255,0.3)'}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

function StarsDark({ count, size = 14 }: { count: number; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={size}
          fill={i < count ? GOLD : 'transparent'}
          stroke={i < count ? GOLD : '#ccc'}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11,
        color: '#6B8F71',
        fontWeight: 500,
      }}
    >
      <Verified size={12} fill="#6B8F71" stroke="#fff" />
      Verified
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Browser frame wrapper                                             */
/* ------------------------------------------------------------------ */

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid var(--border-primary, #e2e2e2)',
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 16px',
          background: 'var(--bg-secondary, #f5f5f5)',
          borderBottom: '1px solid var(--border-primary, #e2e2e2)',
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F57' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD2E' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28CA41' }} />
        <span
          style={{
            marginLeft: 12,
            flex: 1,
            height: 24,
            borderRadius: 6,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-primary, #e2e2e2)',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 10,
            fontSize: 11,
            color: 'var(--text-tertiary, #999)',
          }}
        >
          outlight.co/products/aven-path-light
        </span>
      </div>
      {/* Content area */}
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CONCEPT 1 — Editorial Grid                                       */
/* ------------------------------------------------------------------ */

function EditorialGrid() {
  return (
    <BrowserFrame>
      <div style={{ padding: '48px 40px 60px', background: '#FEFDFB', fontFamily: FONT }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: GOLD,
              marginBottom: 8,
            }}
          >
            AVEN PATH LIGHT
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 6 }}>
            <StarsDark count={5} size={18} />
            <span style={{ fontSize: 28, fontWeight: 700, color: DARK }}>4.8</span>
          </div>
          <p style={{ fontSize: 14, color: '#888' }}>Based on {MOCK_REVIEWS.length} reviews</p>
        </div>

        {/* Masonry-style grid (simulated with CSS columns) */}
        <div
          style={{
            columnCount: 3,
            columnGap: 20,
          }}
        >
          {MOCK_REVIEWS.map((review, idx) => {
            const imageHeight = idx % 3 === 0 ? 280 : idx % 3 === 1 ? 220 : 250;
            return (
              <div
                key={review.id}
                style={{
                  breakInside: 'avoid',
                  marginBottom: 20,
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: '#fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  transition: 'transform 0.25s ease, box-shadow 0.25s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
                }}
              >
                {/* Image area */}
                <div
                  style={{
                    height: imageHeight,
                    background: IMAGE_GRADIENTS[idx],
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Subtle grain texture */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.15,
                      backgroundImage:
                        'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
                      backgroundSize: '128px 128px',
                    }}
                  />
                  {/* Bottom gradient overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '50%',
                      background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
                    }}
                  />
                  {/* Stars on image */}
                  <div style={{ position: 'absolute', bottom: 12, left: 14 }}>
                    <Stars count={review.rating} size={13} />
                  </div>
                </div>

                {/* Text content */}
                <div style={{ padding: '16px 18px 20px' }}>
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: DARK,
                      margin: 0,
                      marginBottom: 8,
                      lineHeight: 1.3,
                    }}
                  >
                    {review.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      color: '#666',
                      lineHeight: 1.5,
                      margin: 0,
                      marginBottom: 12,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {review.body}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: DARK }}>{review.author}</span>
                      {review.verified && <VerifiedBadge />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#aaa', fontSize: 12 }}>
                      <Heart size={12} />
                      <span>{review.helpful}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  CONCEPT 2 — Immersive Overlay                                     */
/* ------------------------------------------------------------------ */

function ImmersiveOverlay() {
  return (
    <BrowserFrame>
      <div style={{ padding: '32px 24px 48px', background: '#1A1A1A', fontFamily: FONT }}>
        {/* Minimal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F5F0E8', margin: 0, letterSpacing: 0.5 }}>
              Aven Path Light
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Stars count={5} size={14} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                4.8 / 5 &middot; {MOCK_REVIEWS.length} reviews
              </span>
            </div>
          </div>
          <button
            style={{
              background: 'transparent',
              border: `1px solid ${GOLD}`,
              color: GOLD,
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: FONT,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Write a Review <ArrowUpRight size={12} />
          </button>
        </div>

        {/* Grid with featured first card */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
          }}
        >
          {MOCK_REVIEWS.map((review, idx) => {
            const isFeatured = idx === 0;
            return (
              <div
                key={review.id}
                style={{
                  gridColumn: isFeatured ? 'span 2' : 'span 1',
                  gridRow: isFeatured ? 'span 1' : 'span 1',
                  aspectRatio: isFeatured ? '8 / 5' : '3 / 4',
                  borderRadius: 8,
                  overflow: 'hidden',
                  position: 'relative',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  const overlay = (e.currentTarget as HTMLElement).querySelector('[data-overlay]') as HTMLElement;
                  if (overlay) overlay.style.height = '75%';
                }}
                onMouseLeave={(e) => {
                  const overlay = (e.currentTarget as HTMLElement).querySelector('[data-overlay]') as HTMLElement;
                  if (overlay) overlay.style.height = '60%';
                }}
              >
                {/* Background image */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: IMAGE_GRADIENTS[idx],
                  }}
                >
                  {/* Grain */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.12,
                      backgroundImage:
                        'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
                      backgroundSize: '128px 128px',
                    }}
                  />
                </div>

                {/* Overlay gradient */}
                <div
                  data-overlay=""
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '60%',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
                    transition: 'height 0.4s ease',
                  }}
                />

                {/* Text content */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: isFeatured ? '24px 28px' : '16px 18px',
                    zIndex: 1,
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <Stars count={review.rating} size={isFeatured ? 14 : 12} />
                  </div>
                  <h3
                    style={{
                      fontSize: isFeatured ? 20 : 14,
                      fontWeight: 700,
                      color: '#F5F0E8',
                      margin: 0,
                      marginBottom: 6,
                      lineHeight: 1.3,
                    }}
                  >
                    {review.title}
                  </h3>
                  <p
                    style={{
                      fontSize: isFeatured ? 14 : 12,
                      color: 'rgba(244,240,235,0.7)',
                      lineHeight: 1.5,
                      margin: 0,
                      marginBottom: 10,
                      display: '-webkit-box',
                      WebkitLineClamp: isFeatured ? 3 : 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {review.body}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: GOLD }}>{review.author}</span>
                    {review.verified && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                        <Verified size={10} fill="rgba(255,255,255,0.4)" stroke="#1A1A1A" />
                        Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  CONCEPT 3 — Testimonial Showcase                                  */
/* ------------------------------------------------------------------ */

function TestimonialShowcase() {
  return (
    <BrowserFrame>
      <div style={{ padding: '56px 48px 64px', background: WARM_BG, fontFamily: FONT }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: GOLD,
              marginBottom: 12,
            }}
          >
            REVIEWS
          </p>
          <h2
            style={{
              fontSize: 36,
              fontWeight: 300,
              color: DARK,
              margin: 0,
              marginBottom: 16,
              fontFamily: "'Georgia', 'Newsreader', serif",
              fontStyle: 'italic',
            }}
          >
            Customers Love Aven
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <StarsDark count={5} size={16} />
            <span style={{ fontSize: 14, color: '#888', fontWeight: 500 }}>4.8 out of 5</span>
          </div>
        </div>

        {/* Alternating rows */}
        {MOCK_REVIEWS.map((review, idx) => {
          const imageOnLeft = idx % 2 === 0;

          const imageBlock = (
            <div
              style={{
                width: '55%',
                minHeight: 280,
                borderRadius: 10,
                overflow: 'hidden',
                position: 'relative',
                border: `1px solid rgba(197,160,89,0.2)`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: IMAGE_GRADIENTS[idx],
                }}
              />
              {/* Grain */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0.1,
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
                  backgroundSize: '128px 128px',
                }}
              />
            </div>
          );

          const textBlock = (
            <div
              style={{
                width: '45%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: imageOnLeft ? '0 0 0 40px' : '0 40px 0 0',
              }}
            >
              {/* Decorative quote */}
              <Quote
                size={36}
                fill={GOLD}
                stroke="none"
                style={{ marginBottom: 16, opacity: 0.6 }}
              />
              <p
                style={{
                  fontSize: 18,
                  lineHeight: 1.7,
                  color: DARK,
                  margin: 0,
                  marginBottom: 20,
                  fontFamily: "'Georgia', 'Newsreader', serif",
                  fontStyle: 'italic',
                }}
              >
                {review.body}
              </p>
              <div style={{ marginBottom: 14 }}>
                <StarsDark count={review.rating} size={14} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: DARK }}>{review.author}</span>
                {review.verified && <VerifiedBadge />}
              </div>
              <p style={{ fontSize: 12, color: '#999', margin: 0 }}>
                {review.variant} &middot; {review.date}
              </p>
            </div>
          );

          return (
            <div key={review.id}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: imageOnLeft ? 'row' : 'row-reverse',
                  alignItems: 'stretch',
                  gap: 0,
                }}
              >
                {imageBlock}
                {textBlock}
              </div>
              {/* Gold divider (not after last item) */}
              {idx < MOCK_REVIEWS.length - 1 && (
                <div
                  style={{
                    height: 1,
                    background: `linear-gradient(to right, transparent 10%, ${GOLD}40 50%, transparent 90%)`,
                    margin: '40px 0',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                   */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: 'editorial', label: 'Editorial Grid', component: EditorialGrid },
  { key: 'immersive', label: 'Immersive Overlay', component: ImmersiveOverlay },
  { key: 'testimonial', label: 'Testimonial Showcase', component: TestimonialShowcase },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function PhotoReviewsPlaygroundPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('editorial');

  const ActiveConcept = TABS.find((t) => t.key === activeTab)!.component;

  return (
    <div style={{ padding: '0 0 64px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <Link
          href="/reviews/widgets"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--text-tertiary, #888)',
            textDecoration: 'none',
            marginBottom: 12,
          }}
        >
          <ArrowLeft size={14} />
          Back to Widgets
        </Link>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary, #1a1a1a)',
            margin: 0,
            marginBottom: 4,
          }}
        >
          Photo Reviews Widget — Playground
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary, #888)', margin: 0 }}>
          Explore design concepts for the photo-centric review widget
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 32,
          borderBottom: '1px solid var(--border-primary, #e2e2e2)',
          marginBottom: 32,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none',
                border: 'none',
                padding: '0 0 12px',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? GOLD : 'var(--text-tertiary, #888)',
                cursor: 'pointer',
                borderBottom: isActive ? `2px solid ${GOLD}` : '2px solid transparent',
                marginBottom: -1,
                transition: 'color 0.2s, border-color 0.2s',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active concept */}
      <ActiveConcept />
    </div>
  );
}
