/**
 * Button — tokenized primitive replacing ad-hoc inline-styled buttons across the
 * dashboard. Variants map to .ds-btn-* classes in globals.css; the primary variant
 * uses the per-brand accent so CTAs re-theme automatically. See
 * docs/PLATFORM-OVERHAUL.md (Stage 1).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    'ds-btn',
    `ds-btn--${variant}`,
    size === 'sm' ? 'ds-btn--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} {...rest}>
      {leadingIcon}
      {children}
    </button>
  );
}
