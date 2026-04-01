'use client';

import Link from 'next/link';
import { Star, Image, Palette, TestTube, ArrowRight, Code } from 'lucide-react';

const widgets = [
  {
    id: 'product-reviews',
    title: 'Product Reviews Widget',
    icon: Star,
    description:
      'Classic review display for product pages. Shows star ratings, written reviews, verified badges, and customer photos in a grid or list layout.',
    designHref: '/reviews/design',
    playgroundHref: '/reviews/playground',
    preview: 'stars',
  },
  {
    id: 'photo-reviews',
    title: 'Photo Reviews Widget',
    icon: Image,
    description:
      'Image-centric testimonial cards that highlight customer photos front and center. Perfect for visual products and social proof sections.',
    designHref: '/reviews/widgets/photo-reviews/design',
    playgroundHref: '/reviews/widgets/photo-reviews/playground',
    preview: 'photo',
  },
] as const;

function StarsPreview() {
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '10px',
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, var(--bg-secondary))',
        border: '1px solid var(--border-primary)',
      }}
    >
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div
          style={{
            fontSize: '20px',
            fontWeight: 700,
            fontFamily: 'Newsreader, serif',
            color: 'var(--text-primary)',
          }}
        >
          4.8
        </div>
        <div style={{ display: 'flex', gap: '2px' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star
              key={i}
              size={12}
              fill={i <= 4 ? '#C5A059' : 'none'}
              stroke={i <= 4 ? '#C5A059' : '#C5A059'}
              strokeWidth={1.5}
            />
          ))}
        </div>
        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>128 reviews</span>
      </div>

      {/* Mock review cards */}
      {[1, 2].map((card) => (
        <div
          key={card}
          style={{
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            marginBottom: card === 1 ? '8px' : '0',
          }}
        >
          <div style={{ display: 'flex', gap: '2px', marginBottom: '6px' }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                size={9}
                fill={s <= (card === 1 ? 5 : 4) ? '#C5A059' : 'none'}
                stroke="#C5A059"
                strokeWidth={1.5}
              />
            ))}
          </div>
          <div
            style={{
              height: '6px',
              width: card === 1 ? '75%' : '60%',
              borderRadius: '3px',
              backgroundColor: 'var(--text-primary)',
              opacity: 0.15,
              marginBottom: '5px',
            }}
          />
          <div
            style={{
              height: '5px',
              width: card === 1 ? '90%' : '80%',
              borderRadius: '3px',
              backgroundColor: 'var(--text-primary)',
              opacity: 0.08,
              marginBottom: '3px',
            }}
          />
          <div
            style={{
              height: '5px',
              width: card === 1 ? '50%' : '65%',
              borderRadius: '3px',
              backgroundColor: 'var(--text-primary)',
              opacity: 0.08,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function PhotoPreview() {
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '10px',
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, var(--bg-secondary))',
        border: '1px solid var(--border-primary)',
      }}
    >
      {/* Two photo review cards side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {[1, 2].map((card) => (
          <div
            key={card}
            style={{
              borderRadius: '8px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              overflow: 'hidden',
            }}
          >
            {/* Image placeholder */}
            <div
              style={{
                height: '64px',
                backgroundColor: card === 1 ? '#E8DFD0' : '#D6CFC3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Image size={20} stroke="#C5A059" strokeWidth={1.2} style={{ opacity: 0.5 }} />
            </div>
            {/* Text area */}
            <div style={{ padding: '8px 10px' }}>
              <div style={{ display: 'flex', gap: '2px', marginBottom: '5px' }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={8}
                    fill={s <= (card === 1 ? 5 : 4) ? '#C5A059' : 'none'}
                    stroke="#C5A059"
                    strokeWidth={1.5}
                  />
                ))}
              </div>
              <div
                style={{
                  height: '5px',
                  width: '80%',
                  borderRadius: '3px',
                  backgroundColor: 'var(--text-primary)',
                  opacity: 0.12,
                  marginBottom: '3px',
                }}
              />
              <div
                style={{
                  height: '5px',
                  width: '55%',
                  borderRadius: '3px',
                  backgroundColor: 'var(--text-primary)',
                  opacity: 0.08,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReviewWidgetsPage() {
  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h2
          style={{
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: '6px',
          }}
        >
          Review Widgets
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Choose a widget to customize its design and preview
        </p>
      </div>

      {/* Widget cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {widgets.map((widget) => {
          const IconComponent = widget.icon;
          return (
            <div
              key={widget.id}
              style={{
                borderRadius: '14px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.boxShadow =
                  '0 4px 24px color-mix(in srgb, var(--color-accent) 12%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-primary)';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
              }}
            >
              {/* Card body */}
              <div style={{ padding: '24px 24px 16px' }}>
                {/* Icon + title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    }}
                  >
                    <IconComponent size={18} style={{ color: 'var(--color-accent)' }} />
                  </div>
                  <h3
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      margin: 0,
                    }}
                  >
                    {widget.title}
                  </h3>
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: '12.5px',
                    lineHeight: '1.55',
                    color: 'var(--text-secondary)',
                    margin: '0 0 16px',
                  }}
                >
                  {widget.description}
                </p>

                {/* Visual preview */}
                {widget.preview === 'stars' ? <StarsPreview /> : <PhotoPreview />}
              </div>

              {/* Action links */}
              <div
                style={{
                  display: 'flex',
                  borderTop: '1px solid var(--border-primary)',
                }}
              >
                <Link
                  href={widget.designHref}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '13px 16px',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    transition: 'background-color 0.15s, color 0.15s',
                    borderRight: '1px solid var(--border-primary)',
                    borderRadius: '0 0 0 14px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'color-mix(in srgb, var(--color-accent) 8%, transparent)';
                    e.currentTarget.style.color = 'var(--color-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                >
                  <Palette size={14} />
                  Design
                  <ArrowRight size={12} style={{ opacity: 0.5 }} />
                </Link>
                <Link
                  href={widget.playgroundHref}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '13px 16px',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    transition: 'background-color 0.15s, color 0.15s',
                    borderRadius: '0 0 14px 0',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'color-mix(in srgb, var(--color-accent) 8%, transparent)';
                    e.currentTarget.style.color = 'var(--color-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                >
                  <TestTube size={14} />
                  Playground
                  <ArrowRight size={12} style={{ opacity: 0.5 }} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
