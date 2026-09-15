import { setLocale, t, useLocale } from '../i18n/index.js';

/**
 * The es/en switch. Rendered once per screen: inline in the topbar when it's
 * shown, or floating top-right on the early-return screens (loading, login,
 * change-password) that have no topbar at all.
 */
export function LocaleToggle({ floating = false }: { floating?: boolean }) {
  const locale = useLocale();
  return (
    <button
      type="button"
      className={floating ? 'locale-toggle--floating' : undefined}
      onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
      aria-label={t('locale.switchTo')}
    >
      {/* Flag of the language you switch TO; aria-label carries the text. */}
      <span aria-hidden="true">{locale === 'es' ? '🇬🇧' : '🇪🇸'}</span>
    </button>
  );
}
