const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

// Strip /api/v1 suffix to get the backend origin (e.g. http://localhost:8000).
// Used to resolve relative image URLs like /uploads/cars/... that the
// LocalImageStorage backend returns.
export const BACKEND_ORIGIN = BASE_URL.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');

/** Resolves a potentially-relative image URL to an absolute URL. */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) return url;
  return `${BACKEND_ORIGIN}${url.startsWith('/') ? url : '/' + url}`;
}

/** Custom error that carries the HTTP status code. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('access_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options?.headers,
  };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers, cache: 'no-cache' });
  } catch {
    throw new HttpError(503, 'Network error');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: `Server error ${res.status}` }));
    throw new HttpError(res.status, error.detail ?? 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};