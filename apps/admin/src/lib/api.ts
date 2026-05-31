/**
 * Typed API client for the admin console (Stage 6 of the overhaul — see
 * docs/PLATFORM-OVERHAUL.md). Centralizes the base path, JSON handling, query
 * serialization, and error normalization so pages stop hand-rolling `fetch()`
 * with ad-hoc error handling. Additive: adopt incrementally, page by page.
 *
 *   const { tickets } = await api.get<TicketList>('/tickets', { status: 'open' });
 *   await api.post('/tickets/bulk', { ids, status: 'closed' });
 *
 * Calls hit the admin's own Next API routes (which forward to the backend with
 * the auth cookie), so no token handling is needed here.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api';

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as Record<string, unknown>).error === 'string')
        ? (body as Record<string, string>).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(buildUrl(path, opts.query), init);
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body, query }),
  patch: <T>(path: string, body?: unknown, query?: Query) => request<T>('PATCH', path, { body, query }),
  put: <T>(path: string, body?: unknown, query?: Query) => request<T>('PUT', path, { body, query }),
  del: <T>(path: string, query?: Query) => request<T>('DELETE', path, { query }),
};
