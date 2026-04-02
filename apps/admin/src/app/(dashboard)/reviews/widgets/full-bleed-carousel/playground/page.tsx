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
  photoUrl: string | null;
  hasPhoto: boolean;
}

const MOCK_REVIEWS: Review[] = [
  {
    id: '1',
    author: 'Eleanor C.',
    rating: 5,
    date: 'Feb 26, 2026',
    snippet: 'The style is so versatile, it can go with any room decor and look perfectly in style.',
    fullText:
      'The style is so versatile, it can go with any room decor and look perfectly in style. The warm glow creates such a calm atmosphere in our living room. Absolutely love it.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 3,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/6948aa41-6961-4a94-86ea-ed49220b1205/1774248104716-2a8f76.jpg',
    hasPhoto: true,
  },
  {
    id: '2',
    author: 'Cuong N.',
    rating: 5,
    date: 'Feb 23, 2026',
    snippet: 'Beautiful floor lamp! Received within 4 days. Excellent service.',
    fullText:
      'Beautiful floor lamp! Received within 4 days. Excellent service. Thank you. The packaging was flawless and the lamp exceeded expectations.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 1,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/07aa8334-f620-4dea-990e-2946c98ee956/1774248104688-nbp3qp.jpg',
    hasPhoto: true,
  },
  {
    id: '3',
    author: 'Marcia R.',
    rating: 5,
    date: 'Feb 20, 2026',
    snippet: "I love my light in my MCM 1970 home. It's perfect.",
    fullText:
      "I love my light in my MCM 1970 home. It's perfect. The craftsmanship is beautiful and it creates the most wonderful ambiance in the evening.",
    verified: true,
    variant: 'Aven — Small (44.1")',
    helpful: 5,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/c5e166ed-93f4-4465-b0bc-8afb7027801a/1774248104693-3ohkwp.jpg',
    hasPhoto: true,
  },
  {
    id: '4',
    author: 'Paola A.',
    rating: 5,
    date: 'Feb 18, 2026',
    snippet: 'Love the lamp the service the people. 100% and 5 stars for everything.',
    fullText:
      'Love the lamp the service the people. 100% and 5 stars for everything. Flawlessly execution and flawless customer service and countless compliments on our lamp.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 0,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/2fea9c1c-d980-4e02-8744-4822adcd5284/1774248104691-tf4z3g.jpg',
    hasPhoto: true,
  },
  {
    id: '5',
    author: 'Rob B.',
    rating: 5,
    date: 'Feb 8, 2026',
    snippet: 'Really beautiful statement piece. Packaged well.',
    fullText:
      'Really beautiful statement piece. Packaged well. The lamp arrived in perfect condition and looks stunning in our entryway. Gets compliments every time someone visits.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 2,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/99db5084-00e0-4b87-9d33-dca06c0fed55/1774248104075-r9u75i.jpg',
    hasPhoto: true,
  },
  {
    id: '6',
    author: 'David L.',
    rating: 5,
    date: 'Mar 20, 2026',
    snippet: 'Came fast. Perfect shape and ready to go out of the box.',
    fullText:
      'Came fast. Perfect shape and ready to go out of the box. Beautiful and adds ambiance to any room. Very happy with this purchase.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 0,
    photoUrl: null,
    hasPhoto: false,
  },
  {
    id: '7',
    author: 'Scott G.',
    rating: 5,
    date: 'Mar 13, 2026',
    snippet: 'Very stylish. Get compliments.',
    fullText:
      'Very stylish. Get compliments from everyone who sees it. The build quality is excellent and the light output is perfect for our space.',
    verified: true,
    variant: 'Aven — Small (44.1")',
    helpful: 0,
    photoUrl: null,
    hasPhoto: false,
  },
];

/* ------------------------------------------------------------------ */
/*  V20 Card component                                                 */
/* ------------------------------------------------------------------ */

function V20Card({ review, width, height }: { review: Review; width: number; height: number }) {
  const [hovered, setHovered] = useState(false);
  const [liked, setLiked] = useState(false);
  const isPhoto = review.hasPhoto && review.photoUrl !== null;
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
      {isPhoto && review.photoUrl && (
        <>
          <div style={{ position: 'absolute', inset: 0 }}>
            <img
              src={review.photoUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
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
            fontSize: '0.88rem',
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
            fontSize: '0.62rem',
            fontWeight: 300,
            color: isPhoto ? 'rgba(255,255,255,0.4)' : 'rgba(45,51,56,0.3)',
          }}
        >
          {review.date}
        </div>

        {/* Snippet */}
        <div
          style={{
            fontSize: '0.82rem',
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
                fontSize: '0.82rem',
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
                style={{ fontSize: '0.6rem', fontWeight: 300, color: 'rgba(255,255,255,0.3)' }}
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
                  fontSize: '0.6rem',
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
              style={{ fontSize: '0.6rem', fontWeight: 300, color: 'rgba(45,51,56,0.28)' }}
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
          AVEN FLOOR LAMP
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
            4.9
          </span>
          <div style={{ display: 'inline-flex', gap: 3 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                size={16}
                fill={i <= 5 ? GOLD : 'transparent'}
                stroke={i <= 5 ? GOLD : '#ddd'}
                strokeWidth={1.5}
              />
            ))}
          </div>
          <span style={{ fontSize: 13, color: '#888' }}>
            218 reviews
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
          {url || 'outlight.us/products/aven'}
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
