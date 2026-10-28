// The product's frame finishes; the choice only dresses the thumbnails and is kept per browser.
const KEY = 'memento.finish';

export const FINISHES = [
  ['black', 'Noir'],
  ['silver', 'Argent'],
  ['darkbrown', 'Brun foncé'],
  ['auburn', 'Auburn'],
  ['walnut', 'Noyer'],
];

export function readFinish() {
  try {
    const value = localStorage.getItem(KEY);
    return FINISHES.some(([key]) => key === value) ? value : FINISHES[0][0];
  } catch {
    return FINISHES[0][0];
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
