const BRAND_SLUG = 'warm-by-design';
let baseUrl = '';

export function initBaseUrl(): void {
  const scripts = document.querySelectorAll('script[src]');
  for (const script of Array.from(scripts)) {
    const src = (script as HTMLScriptElement).src || '';
    if (src.includes('/widget/warm/reviews.js')) {
      baseUrl = new URL(src).origin;
      return;
    }
  }
  baseUrl = window.location.origin;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Brand': BRAND_SLUG,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      /* keep status fallback */
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

export interface ReviewMedia {
  id: string;
  url: string;
  media_type: 'image' | 'video';
  sort_order: number;
}

export interface ReviewReply {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  customer_name: string;
  customer_nickname: string | null;
  city?: string | null;
  verified_purchase: boolean;
  helpful_count: number;
  submitted_at: string;
  published_at: string | null;
  media?: ReviewMedia[];
  reply?: ReviewReply | null;
}

interface RawDistributionItem {
  stars?: number;
  rating?: number;
  count: number;
  pct?: number;
}

export interface ReviewSummary {
  average_rating: number;
  total_count: number;
  verified_count: number;
  recommend_pct: number;
  with_photos_count: number;
  distribution: { rating: number; count: number; pct: number }[];
}

export interface WidgetConfig {
  reviews_per_page: number;
  default_sort: 'newest' | 'oldest' | 'most_helpful' | 'most_recent' | 'highest' | 'lowest';
  show_verified_badge: boolean;
  show_incentivized_disclosure: boolean;
  incentivized_disclosure_text: string;
}

export interface ReviewsResponse {
  reviews: Review[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export interface SubmitReviewPayload {
  product_handle: string;
  customer_email: string;
  customer_name: string;
  rating: number;
  body: string;
  title?: string;
  media_urls?: string[];
}

function normalizeSummary(raw: ReviewSummary & { distribution?: RawDistributionItem[] }): ReviewSummary {
  const total = raw.total_count || 0;
  const distribution = [5, 4, 3, 2, 1].map((rating) => {
    const found = raw.distribution?.find((d) => (d.rating ?? d.stars) === rating);
    const count = found?.count ?? 0;
    return {
      rating,
      count,
      pct: found?.pct ?? (total > 0 ? Math.round((count / total) * 100) : 0),
    };
  });
  const positive = distribution
    .filter((d) => d.rating >= 4)
    .reduce((sum, d) => sum + d.count, 0);

  return {
    average_rating: raw.average_rating || 0,
    total_count: total,
    verified_count: raw.verified_count || 0,
    recommend_pct: raw.recommend_pct ?? (total > 0 ? Math.round((positive / total) * 100) : 0),
    with_photos_count: raw.with_photos_count ?? 0,
    distribution,
  };
}

export async function getWidgetConfig(): Promise<WidgetConfig> {
  return request<WidgetConfig>('/api/reviews/widget/config');
}

export async function getReviewSummary(handle: string): Promise<ReviewSummary> {
  const raw = await request<ReviewSummary & { distribution?: RawDistributionItem[] }>(
    `/api/reviews/product/${encodeURIComponent(handle)}/summary`,
  );
  return normalizeSummary(raw);
}

export async function getReviews(
  handle: string,
  opts: { page?: number; perPage?: number; sort?: string; rating?: number; verified?: boolean } = {},
): Promise<ReviewsResponse> {
  const params = new URLSearchParams();
  const sort = opts.sort === 'most_recent' ? 'newest' : opts.sort;
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('per_page', String(opts.perPage));
  if (sort) params.set('sort', sort);
  if (opts.rating) params.set('rating', String(opts.rating));
  if (opts.verified) params.set('verified', 'true');
  const qs = params.toString();
  return request<ReviewsResponse>(
    `/api/reviews/product/${encodeURIComponent(handle)}${qs ? `?${qs}` : ''}`,
  );
}

export async function submitReview(payload: SubmitReviewPayload): Promise<Review> {
  return request<Review>('/api/reviews/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function uploadMedia(file: File): Promise<{ url: string; path: string }> {
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const file_b64 = dataUrl.split(',')[1] ?? '';
  return request<{ url: string; path: string }>('/api/reviews/upload', {
    method: 'POST',
    body: JSON.stringify({
      file: file_b64,
      content_type: file.type,
      filename: file.name,
    }),
  });
}

export async function markHelpful(reviewId: string): Promise<{ helpful_count: number }> {
  return request<{ helpful_count: number }>(`/api/reviews/helpful/${reviewId}`, { method: 'POST' });
}

export async function reportReview(reviewId: string): Promise<{ report_count: number }> {
  return request<{ report_count: number }>(`/api/reviews/report/${reviewId}`, { method: 'POST' });
}

