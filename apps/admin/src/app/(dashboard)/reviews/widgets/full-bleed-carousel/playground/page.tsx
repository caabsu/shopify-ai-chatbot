'use client';

import { useState } from 'react';
import { Star, ArrowLeft, ThumbsUp, BadgeCheck } from 'lucide-react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Brand constants                                                    */
/* ------------------------------------------------------------------ */

const GOLD = '#C5A059';
const DARK = '#2D3338';
const FONT = "'Manrope', system-ui, sans-serif";

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  snippet: string;
  fullText: string;
  verified: boolean;
  variant: string;
  helpful: number;
  gradient: string | null;
  hasPhoto: boolean;
}

const MOCK_REVIEWS: Review[] = [
  {
    id: '1',
    author: 'Sarah M.',
    rating: 5,
    date: 'Mar 15, 2026',
    snippet: 'The Aven light transformed our outdoor space.',
    fullText:
      'The Aven light transformed our outdoor space completely. The warm glow is perfect for evening dinners on the patio. Build quality is exceptional — feels genuinely premium.',
    verified: true,
    variant: 'Brass / Warm White',
    helpful: 12,
    gradient: 'linear-gradient(160deg, #C49A3C 0%, #7A6322 50%, #2D2A1F 100%)',
    hasPhoto: true,
  },
  {
    id: '2',
    author: 'James K.',
    rating: 5,
    date: 'Feb 28, 2026',
    snippet: 'Installed 8 of these along our walkway.',
    fullText:
      'Installed 8 of these along our walkway. The brass finish is gorgeous and they survived a harsh winter without any issues. The light color is exactly right.',
    verified: true,
    variant: 'Brass / Daylight',
    helpful: 8,
    gradient: 'linear-gradient(145deg, #D4A846 0%, #8B6914 45%, #342E1C 100%)',
    hasPhoto: true,
  },
  {
    id: '3',
    author: 'Rachel T.',
    rating: 4,
    date: 'Feb 10, 2026',
    snippet: 'Love the minimalist design. Easy install.',
    fullText:
      'Love the minimalist design. Took about 20 minutes to install each light. The finish matches our fixtures perfectly. Only wish the cable was a bit longer — had to buy an extension.',
    verified: true,
    variant: 'Black / Warm White',
    helpful: 5,
    gradient: null,
    hasPhoto: false,
  },
  {
    id: '4',
    author: 'David L.',
    rating: 5,
    date: 'Jan 22, 2026',
    snippet: 'These lights elevated our entire landscape design.',
    fullText:
      'These lights elevated our entire landscape design. The warm brass tone complements our home perfectly. Our landscape designer was impressed with the quality. Highly recommend.',
    verified: true,
    variant: 'Brass / Warm White',
    helpful: 15,
    gradient: 'linear-gradient(155deg, #DDB94E 0%, #A58830 40%, #6E5922 70%, #2F2B20 100%)',
    hasPhoto: true,
  },
  {
    id: '5',
    author: 'Monica P.',
    rating: 5,
    date: 'Jan 5, 2026',
    snippet: 'Six months in and they still look brand new.',
    fullText:
      'Six months in and they still look brand new. The light output is perfect — not too bright, not too dim. Exactly what we wanted for our garden path. Weather resistance is excellent.',
    verified: true,
    variant: 'Black / Daylight',
    helpful: 7,
    gradient: 'linear-gradient(140deg, #C9A445 0%, #957428 35%, #634E1E 65%, #2A261C 100%)',
    hasPhoto: true,
  },
  {
    id: '6',
    author: 'Tom H.',
    rating: 5,
    date: 'Dec 18, 2025',
    snippet: 'Every guest asks where we got our path lights.',
    fullText:
      'Every time we have guests, someone asks where we got our path lights. The quality speaks for itself. Already ordered more for the front yard. The packaging was beautiful too — makes a great gift.',
    verified: true,
    variant: 'Brass / Warm White',
    helpful: 22,
    gradient: 'linear-gradient(130deg, #CFAA4F 0%, #9A7B2C 45%, #5E4B20 75%, #28241C 100%)',
    hasPhoto: true,
  },
];

/* ------------------------------------------------------------------ */
/*  V20 Card component                                                 */
/* ------------------------------------------------------------------ */

function V20Card({ review, width, height }: { review: Review; width: number; height: number }) {
  const [hovered, setHovered] = useState(false);
  const [liked, setLiked] = useState(false);
  const isPhoto = review.hasPhoto && review.gradient !== null;
  const br = 6;

  return (
    <div
      style={{
        flex: `0 0 ${width}px`,
        height,
        scrollSnapAlign: 'start',
        borderRadius: br,
        overflow: 'hidden',
        position: 'relative',
        background: isPhoto ? 'transparent' : '#f4f0eb',
        boxShadow: hovered
          ? '0 2px 4px rgba(0,0,0,0.04), 0 8px 28px rgba(0,0,0,0.08)'
          : '0 1px 2px rgba(0,0,0,0.03), 0 4px 16px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'box-shadow 0.3s, transform 0.3s',
        cursor: 'pointer',
        flexShrink: 0,
        fontFamily: FONT,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Photo background */}
      {isPhoto && review.gradient && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: review.gradient }} />
          {/* Gradient overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(transparent 30%, rgba(0,0,0,0.7))',
            }}
          />
        </>
      )}

      {/* Content */}
      <div
        style={{
          position: isPhoto ? 'absolute' : 'relative',
          bottom: 0,
          left: 0,
          right: 0,
          padding: isPhoto ? 24 : 28,
        }}
      >
        {/* Stars */}
        <div style={{ display: 'inline-flex', gap: 2 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              size={11}
              fill={i < review.rating ? (isPhoto ? '#fff' : GOLD) : 'transparent'}
              stroke={isPhoto ? '#fff' : GOLD}
              strokeWidth={1.5}
            />
          ))}
        </div>

        {/* Author + verified */}
        <div
          style={{
            fontSize: '0.8rem',
            fontWeight: 400,
            color: isPhoto ? '#fff' : DARK,
            margin: '6px 0 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {review.author}
          {review.verified && (
            <BadgeCheck
              size={13}
              fill={GOLD}
              stroke={isPhoto ? '#fff' : DARK}
              strokeWidth={0}
              style={{ opacity: 0.9 }}
            />
          )}
        </div>

        {/* Date */}
        <div
          style={{
            fontSize: '0.56rem',
            fontWeight: 300,
            color: isPhoto ? 'rgba(255,255,255,0.4)' : 'rgba(45,51,56,0.3)',
          }}
        >
          {review.date}
        </div>

        {/* Snippet */}
        <div
          style={{
            fontSize: '0.74rem',
            fontWeight: 300,
            color: isPhoto ? 'rgba(255,255,255,0.65)' : 'rgba(45,51,56,0.55)',
            lineHeight: 1.6,
            margin: '8px 0 0',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: isPhoto ? 2 : undefined,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {review.snippet}
        </div>

        {/* Expanded content on hover (photo cards only) */}
        {isPhoto && (
          <div
            style={{
              maxHeight: hovered ? 200 : 0,
              overflow: 'hidden',
              opacity: hovered ? 1 : 0,
              transition: 'max-height 0.4s ease, opacity 0.3s',
            }}
          >
            <p
              style={{
                fontSize: '0.74rem',
                fontWeight: 300,
                color: 'rgba(255,255,255,0.6)',
                lineHeight: 1.6,
                margin: '8px 0',
              }}
            >
              {review.fullText}
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 8,
                borderTop: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <span
                style={{ fontSize: '0.54rem', fontWeight: 300, color: 'rgba(255,255,255,0.3)' }}
              >
                {review.variant}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLiked((prev) => !prev);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.54rem',
                  fontWeight: 400,
                  color: liked ? GOLD : 'rgba(255,255,255,0.5)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'color 0.2s',
                }}
              >
                <ThumbsUp size={10} />
                {liked ? review.helpful + 1 : review.helpful} helpful
              </button>
            </div>
          </div>
        )}

        {/* No-photo card: always show variant + helpful */}
        {!isPhoto && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 8,
              borderTop: '1px solid rgba(45,51,56,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{ fontSize: '0.54rem', fontWeight: 300, color: 'rgba(45,51,56,0.28)' }}
            >
              {review.variant}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLiked((prev) => !prev);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.54rem',
                fontWeight: 400,
                color: liked ? GOLD : 'rgba(45,51,56,0.35)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                transition: 'color 0.2s',
              }}
            >
              <ThumbsUp size={10} />
              {liked ? review.helpful + 1 : review.helpful} helpful
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  V20 Carousel component                                             */
/* ------------------------------------------------------------------ */

function V20Carousel({
  cardWidth,
  cardHeight,
  containerWidth,
}: {
  cardWidth: number;
  cardHeight: number;
  containerWidth: number;
}) {
  return (
    <div
      style={{
        padding: '48px 40px 60px',
        background: '#FEFDFB',
        fontFamily: FONT,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: GOLD,
            marginBottom: 8,
            marginTop: 0,
          }}
        >
          AVEN PATH LIGHT
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span
            style={{
              fontFamily: "'Newsreader', 'Georgia', serif",
              fontSize: 36,
              fontWeight: 700,
              color: DARK,
              lineHeight: 1,
            }}
          >
            4.8
          </span>
          <div style={{ display: 'inline-flex', gap: 3 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                size={16}
                fill={i <= 4 ? GOLD : 'transparent'}
                stroke={i <= 4 ? GOLD : '#ddd'}
                strokeWidth={1.5}
              />
            ))}
          </div>
          <span style={{ fontSize: 13, color: '#888' }}>
            {MOCK_REVIEWS.length} reviews
          </span>
        </div>
      </div>

      {/* Scrollable carousel */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          paddingBottom: 12,
          /* Styled scrollbar via inline CSS — scrollbar-width for Firefox */
          scrollbarWidth: 'thin',
          scrollbarColor: `${GOLD} transparent`,
        }}
      >
        {MOCK_REVIEWS.map((review) => (
          <V20Card
            key={review.id}
            review={review}
            width={Math.min(cardWidth, containerWidth - 80)}
            height={cardHeight}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Browser frame                                                      */
/* ------------------------------------------------------------------ */

function BrowserFrame({
  children,
  url,
}: {
  children: React.ReactNode;
  url?: string;
}) {
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
          flexShrink: 0,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F57', flexShrink: 0 }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFBD2E', flexShrink: 0 }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28CA41', flexShrink: 0 }} />
        <span
          style={{
            marginLeft: 12,
            flex: 1,
            height: 24,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-primary, #e2e2e2)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 10,
            fontSize: 11,
            color: 'var(--text-tertiary, #999)',
          }}
        >
          {url || 'outlight.co/products/aven-path-light'}
        </span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Phone frame                                                        */
/* ------------------------------------------------------------------ */

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          width: 375,
          border: '8px solid #1a1a1a',
          borderRadius: 40,
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.05)',
          background: '#fff',
          position: 'relative',
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 120,
            height: 28,
            background: '#1a1a1a',
            borderRadius: '0 0 18px 18px',
            zIndex: 10,
          }}
        />
        {/* Status bar */}
        <div
          style={{
            height: 44,
            background: '#FEFDFB',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            padding: '0 20px 6px',
            fontSize: 11,
            fontWeight: 600,
            color: DARK,
            fontFamily: FONT,
          }}
        >
          <span>9:41</span>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span>●●●●</span>
            <span>WiFi</span>
            <span>100%</span>
          </span>
        </div>
        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', maxHeight: 700 }}>{children}</div>
        {/* Home indicator */}
        <div
          style={{
            height: 28,
            background: '#FEFDFB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{ width: 120, height: 4, borderRadius: 2, background: '#ccc' }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function FullBleedCarouselPlaygroundPage() {
  return (
    <div style={{ padding: '0 0 80px' }}>
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
            fontFamily: FONT,
          }}
        >
          Full-Bleed Carousel — Playground
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary, #888)', margin: 0 }}>
          V20 cinematic design preview using Aven Path Light. Hover cards to expand.
        </p>
      </div>

      {/* Desktop preview */}
      <div style={{ marginBottom: 48 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'var(--text-tertiary, #999)',
            }}
          >
            Desktop
          </span>
          <div
            style={{
              height: 1,
              flex: 1,
              background: 'var(--border-primary, #e2e2e2)',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary, #999)' }}>
            ~920px container
          </span>
        </div>
        <BrowserFrame>
          <V20Carousel cardWidth={360} cardHeight={400} containerWidth={920} />
        </BrowserFrame>
      </div>

      {/* Mobile preview */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'var(--text-tertiary, #999)',
            }}
          >
            Mobile
          </span>
          <div
            style={{
              height: 1,
              flex: 1,
              background: 'var(--border-primary, #e2e2e2)',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary, #999)' }}>
            375px iPhone frame
          </span>
        </div>
        <PhoneFrame>
          <V20Carousel cardWidth={280} cardHeight={360} containerWidth={375} />
        </PhoneFrame>
      </div>
    </div>
  );
}
