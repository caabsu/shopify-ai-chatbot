'use client';

import { Star, ArrowLeft, Verified, Heart } from 'lucide-react';
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
    helpful: 22,
  },
];

/* ------------------------------------------------------------------ */
/*  Brand constants                                                   */
/* ------------------------------------------------------------------ */

const GOLD = '#C5A059';
const DARK = '#2D3338';
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

function StarsOnImage({ count, size = 13 }: { count: number; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={size}
          fill={i < count ? GOLD : 'transparent'}
          stroke={i < count ? GOLD : 'rgba(255,255,255,0.3)'}
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
/*  Editorial Grid — locked-in design                                 */
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

        {/* Masonry grid with sharp edges */}
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
                    <StarsOnImage count={review.rating} size={13} />
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
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function PhotoReviewsPlaygroundPage() {
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
          Editorial Grid design preview using Aven Path Light
        </p>
      </div>

      {/* Locked-in design */}
      <EditorialGrid />
    </div>
  );
}
