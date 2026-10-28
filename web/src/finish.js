// The product's frame finishes; the choice only dresses the thumbnails and is kept per browser.
const KEY = 'memento.finish';

// Labels come from the `finish.<key>` translations.
export const FINISHES = ['black', 'silver', 'darkbrown', 'auburn', 'walnut'];

export function readFinish() {
  try {
    const value = localStorage.getItem(KEY);
    return FINISHES.includes(value) ? value : FINISHES[0];
  } catch {
    return FINISHES[0];
  }
}

export function applyFinish(value) {
  document.documentElement.dataset.finish = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}
