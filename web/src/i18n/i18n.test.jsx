import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from './en.js';
import fr from './fr.js';
import { I18nProvider, detectLanguage, useT } from './index.jsx';
import LanguageToggle from '../components/LanguageToggle.jsx';
import Connect from '../screens/Connect.jsx';

vi.mock('../api/client.js');

function Title() {
  return <h1>{useT()('connect.title')}</h1>;
}

describe('i18n', () => {
  it('has the same keys, with the same kind of value, in both languages', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect([key, typeof fr[key], Array.isArray(fr[key])]).toEqual([key, typeof en[key], Array.isArray(en[key])]);
    }
    expect(fr['away.dayNames']).toHaveLength(en['away.dayNames'].length);
  });

  it('follows a stored choice, else the browser language', () => {
    expect(detectLanguage()).toBe('fr');
    localStorage.removeItem('memento.lang');
    const spy = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-CA', 'en']);
    expect(detectLanguage()).toBe('fr');
    spy.mockReturnValue(['en-US']);
    expect(detectLanguage()).toBe('en');
    spy.mockRestore();
  });

  it('switches the whole page language and remembers it', () => {
    render(
      <I18nProvider>
        <LanguageToggle />
        <Title />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Connectez-vous à votre cadre');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Connect to your frame');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('memento.lang')).toBe('en');

    fireEvent.click(screen.getByRole('button', { name: 'Passer en français' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Connectez-vous à votre cadre');
  });

  it('renders a screen in English', () => {
    localStorage.setItem('memento.lang', 'en');
    render(<Connect onConnected={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Connect to your frame' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search the network' })).toBeInTheDocument();
    expect(screen.getByLabelText('IP address')).toBeInTheDocument();
  });
});
