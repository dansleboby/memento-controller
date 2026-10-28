// Thin wrapper over the local /api contract. Relative URLs only: works behind
// the Vite dev proxy and same-origin in production.

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    return body.error || body.message || null;
  } catch {
    return null;
  }
}

export async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    const msg = (await errorMessage(res)) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  // Non-JSON (e.g. PNG thumbnails): return the raw Response on purpose so callers can use blob().
  return type.includes('application/json') ? res.json() : res;
}

export const discover = () => request('/discover');
export const connect = (ip) => request('/connect', { method: 'POST', body: { ip } });
export const disconnect = () => request('/disconnect', { method: 'POST' });
export const getConfig = () => request('/config');
export const setSetting = (action, value) =>
  request('/settings', { method: 'POST', body: { action, value } });
export const setTime = (iso) => request('/time', { method: 'POST', body: { iso } });
export const getFrameTime = () => request('/time');
export const setAwaySchedule = (slots) => request('/away', { method: 'PUT', body: { slots } });

export const getThumbnails = () => request('/thumbnails');
export const thumbnailUrl = (name) => `${BASE}/thumbnails/${encodeURIComponent(name)}`;

// fetch has no upload progress, so XHR is used when a progress callback is given.
export function upload(files, { onProgress } = {}) {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (!onProgress) return request('/upload', { method: 'POST', form });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError('Network error', 0));
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new ApiError((data && (data.error || data.message)) || `Request failed (${xhr.status})`, xhr.status));
    };
    xhr.send(form);
  });
}

export const deleteImages = (names) => request('/images/delete', { method: 'POST', body: { names } });
export const control = (action, name) =>
  request('/control', { method: 'POST', body: name === undefined ? { action } : { action, name } });

export const getAlbums = () => request('/albums');
export const putAlbum = (edit) => request('/albums', { method: 'PUT', body: { edit } });
export const advanced = (action, body = {}) =>
  request('/advanced', { method: 'POST', body: { ...body, action } });

export function subscribeEvents({ onStatus, onUpload } = {}) {
  const es = new EventSource(`${BASE}/events`);
  const parse = (fn) => (e) => {
    try {
      fn?.(JSON.parse(e.data));
    } catch {
      /* ignore malformed event */
    }
  };
  es.addEventListener('status', parse(onStatus));
  es.addEventListener('upload', parse(onUpload));
  return () => es.close();
}
