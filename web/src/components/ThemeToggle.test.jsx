import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeToggle from './ThemeToggle.jsx';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe('ThemeToggle', () => {
  it('switches the page between light and dark and remembers the choice', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Passer au thème sombre' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('memento.theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Passer au thème clair' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('memento.theme')).toBe('light');
  });

  it('starts from a stored choice', () => {
    localStorage.setItem('memento.theme', 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Passer au thème clair' })).toBeInTheDocument();
  });
});
