'use client';

import { useState, useCallback, useRef } from 'react';
import { Star, ArrowLeft, ThumbsUp, BadgeCheck, X, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Brand constants                                                    */
/* ------------------------------------------------------------------ */

const GOLD = '#C5A059';
const DARK = '#2D3338';
const FONT = "'Manrope', system-ui, sans-serif";

/* ------------------------------------------------------------------ */
/*  Real Aven review data (media reviews first, then text-only)        */
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
      'Love the lamp the service the people. 100% and 5 stars for everything. Flawless execution and flawless customer service and countless compliments on our lamp.',
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
      'Really beautiful statement piece. Packaged well. The lamp arrived in perfect condition and looks stunning in our entryway.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 2,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/99db5084-00e0-4b87-9d33-dca06c0fed55/1774248104075-r9u75i.jpg',
    hasPhoto: true,
  },
  {
    id: '6',
    author: 'Michael M.',
    rating: 5,
    date: 'Feb 5, 2026',
    snippet: 'I saw the advertisement on Instagram and immediately ordered it.',
    fullText:
      'I saw the advertisement on Instagram and immediately ordered it. Set up took less than 5 minutes. The lamp is stunning — exactly what our living room needed.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 4,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/cc006e9a-f45b-4bde-afe1-66362781af72/1774248104113-2bxxmf.jpg',
    hasPhoto: true,
  },
  {
    id: '7',
    author: 'CARLINDA B.',
    rating: 5,
    date: 'Feb 3, 2026',
    snippet: 'These 2 lamps add real beauty to that space.',
    fullText:
      'These 2 lamps add real beauty to that space, but I like to change my furniture around so they work everywhere. Beautiful craftsmanship.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 1,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/77ef9da1-db36-48d3-aaba-0c5ef279e6f5/1774248104095-gnnpw1.jpg',
    hasPhoto: true,
  },
  {
    id: '8',
    author: 'Jordan B.',
    rating: 5,
    date: 'Jan 26, 2026',
    snippet: 'Love this lamp so much! Went with the large, which I highly recommend.',
    fullText:
      'Love this lamp so much! Went with the large, which I highly recommend, in fact ordered a second one. The quality is unmatched at this price point.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 3,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/2f85904c-7ff5-4e8d-833e-6f8091982689/1774248104068-gmmgn7.jpg',
    hasPhoto: true,
  },
  {
    id: '9',
    author: 'Carol B.',
    rating: 5,
    date: 'Jan 26, 2026',
    snippet: 'I love the light. Beautiful and super easy to set up. So stylish and creative!',
    fullText:
      'I love the light. Beautiful and super easy to set up. So stylish and creative! It completely transforms our room in the evening.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 2,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/df3fe9f2-a63d-4673-9f44-400fc878cb7c/1774248104097-n6uuxh.jpg',
    hasPhoto: true,
  },
  {
    id: '10',
    author: 'Marco P.',
    rating: 5,
    date: 'Jan 12, 2026',
    snippet: 'Great vibe.',
    fullText:
      'Great vibe. The lamp sets the perfect mood in any room. Minimal, elegant, and the light quality is incredible.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 1,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/d52dc273-53e8-44d8-9c16-4a48bde5b79b/1774248103482-b679ni.jpg',
    hasPhoto: true,
  },
  {
    id: '11',
    author: 'Wayne S.',
    rating: 5,
    date: 'Jan 7, 2026',
    snippet: 'Looks so good in our space.',
    fullText:
      'Looks so good in our space. The warm glow creates the perfect atmosphere for our living room. Highly recommend.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 0,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/61df4254-1c3e-4ff0-947e-717add1098aa/1774248103503-g678zi.jpg',
    hasPhoto: true,
  },
  {
    id: '12',
    author: 'Karen F.',
    rating: 5,
    date: 'Dec 3, 2025',
    snippet: 'I absolutely love this lamp! It is unique and modern.',
    fullText:
      'I absolutely love this lamp! It is unique and modern — and gives the most beautiful warm glow. It is truly a statement piece in our home.',
    verified: true,
    variant: 'Aven — Large (57.1")',
    helpful: 6,
    photoUrl: 'https://wwblkodkycjwmzlflncg.supabase.co/storage/v1/object/public/review-media/imports/89d74862-2060-4769-a60e-0ed31bf18d13/1774248102010-xzbbuo.jpg',
    hasPhoto: true,
  },
  {
    id: '13',
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
    id: '14',
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
/*  Image Lightbox                                                     */
/* ------------------------------------------------------------------ */

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        backdropFilter: 'blur(8px)',
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          background: 'rgba(255,255,255,0.1)',
          border: 'none',
          borderRadius: '50%',
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#fff',
        }}
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt="Review photo"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 8,
          cursor: 'default',
          boxShadow: '0 8px 60px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  V20 Card component                                                 */
/* ------------------------------------------------------------------ */

function V20Card({
  review,
  width,
  height,
  onImageClick,
}: {
  review: Review;
  width: number;
  height: number;
  onImageClick?: (url: string) => void;
}) {
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
        cursor: isPhoto ? 'pointer' : 'default',
        flexShrink: 0,
        fontFamily: FONT,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (isPhoto && review.photoUrl && onImageClick) {
          onImageClick(review.photoUrl);
        }
      }}
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
                fontSize: '0.6rem',
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
  onImageClick,
}: {
  cardWidth: number;
  cardHeight: number;
  containerWidth: number;
  onImageClick?: (url: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateArrows = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = trackRef.current;
    if (!el) return;
    const firstCard = el.querySelector('div') as HTMLElement | null;
    const amount = firstCard ? firstCard.offsetWidth + 14 : cardWidth + 14;
    el.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' });
  }, [cardWidth]);

  const arrowStyle = (side: 'left' | 'right', disabled: boolean): React.CSSProperties => ({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    [side]: 6,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: '1px solid rgba(19,19,20,0.08)',
    background: 'rgba(255,255,255,0.95)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: DARK,
    opacity: disabled ? 0 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
    transition: 'opacity 0.2s, background 0.2s, color 0.2s',
    backdropFilter: 'blur(4px)',
  });

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

      {/* Carousel with arrows */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => scroll('left')}
          onMouseEnter={(e) => { e.currentTarget.style.background = DARK; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.95)'; e.currentTarget.style.color = DARK; }}
          style={arrowStyle('left', !canScrollLeft)}
          aria-label="Previous"
        >
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <button
          onClick={() => scroll('right')}
          onMouseEnter={(e) => { e.currentTarget.style.background = DARK; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.95)'; e.currentTarget.style.color = DARK; }}
          style={arrowStyle('right', !canScrollRight)}
          aria-label="Next"
        >
          <ChevronRight size={20} strokeWidth={2} />
        </button>

        <div
          ref={trackRef}
          onScroll={updateArrows}
          style={{
            display: 'flex',
            gap: 14,
            overflowX: 'auto',
            scrollBehavior: 'smooth',
            paddingBottom: 12,
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
              onImageClick={onImageClick}
            />
          ))}
        </div>
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
            <span style={{ fontSize: 9, letterSpacing: -1 }}>●●●●</span>
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
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const handleImageClick = useCallback((url: string) => {
    setLightboxSrc(url);
  }, []);

  return (
    <div style={{ padding: '0 0 80px' }}>
      {/* Lightbox */}
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

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
          V20 cinematic design with real Aven reviews. Click any photo card to open lightbox.
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
          <V20Carousel
            cardWidth={320}
            cardHeight={480}
            containerWidth={920}
            onImageClick={handleImageClick}
          />
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
            375px iPhone frame — swipe snaps to each card
          </span>
        </div>
        <PhoneFrame>
          <V20Carousel
            cardWidth={280}
            cardHeight={480}
            containerWidth={375}
            onImageClick={handleImageClick}
          />
        </PhoneFrame>
      </div>
    </div>
  );
}
