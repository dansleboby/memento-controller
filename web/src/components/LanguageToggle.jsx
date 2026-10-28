import { useI18n } from '../i18n/index.jsx';

export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'fr' ? 'en' : 'fr';
  return (
    <button
      type="button"
      className="btn-ghost btn-icon btn-sm lang-toggle"
      lang={next}
      aria-label={t('lang.switch')}
      title={t('lang.switch')}
      onClick={() => setLang(next)}
    >
      {next.toUpperCase()}
    </button>
  );
}
