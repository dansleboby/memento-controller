import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// Screen tests assert the French copy; i18n tests opt into English explicitly.
beforeEach(() => {
  localStorage.setItem('memento.lang', 'fr');
});
