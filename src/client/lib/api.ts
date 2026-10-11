const BASE = '';

async function request<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error || body?.message || res.statusText);
  }
  return res.json();
}

export const api = {
  get: <T = any>(url: string) => request<T>(url),
  post: <T = any>(url: string, data?: any) => request<T>(url, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T = any>(url: string, data?: any) => request<T>(url, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T = any>(url: string) => request<T>(url, { method: 'DELETE' }),
  // For file downloads
  download: async (url: string, filename: string) => {
    const res = await fetch(`${BASE}${url}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};
