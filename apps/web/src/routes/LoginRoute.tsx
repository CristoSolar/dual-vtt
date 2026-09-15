import { useState } from 'react';

import { t } from '../i18n/index.js';

interface LoginRouteProps {
  error: string | null;
  pending: boolean;
  onLogin: (username: string, password: string) => void;
}

/** The front door when nobody is logged in yet. Nothing past this point is reachable. */
export function LoginRoute({ error, pending, onLogin }: LoginRouteProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    if (pending || username.trim() === '' || password === '') return;
    onLogin(username.trim(), password);
  };

  return (
    <div className="auth-shell">
      <section className="auth-card auth-card--wide">
        <div className="login-frame">
          <div className="login-art">
            <div className="row">
              <span className="ornament-diamond" aria-hidden="true" />
              <span className="login-art-overline">Dual VTT</span>
            </div>
            <h1 className="login-art-headline">{t('login.headlineArt')}</h1>
            <p className="muted">{t('login.subtitleArt')}</p>
          </div>

          <div className="login-form">
            <div>
              <p className="login-overline">{t('login.overline')}</p>
              <h2 className="login-headline">{t('login.headline')}</h2>
            </div>

            <label htmlFor="login-username">{t('common.username')}</label>
            <input
              id="login-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('common.usernamePlaceholder')}
            />
            <label htmlFor="login-password" className="mt-3">
              {t('login.password')}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            {error !== null ? <div className="errors mt-3">{error}</div> : null}
            <button
              type="button"
              className="btn-primary mt-4"
              disabled={pending || username.trim() === '' || password === ''}
              onClick={submit}
            >
              {pending ? t('login.submitting') : t('login.submit')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
