import { MIN_PASSWORD_LENGTH } from '@daggerheart/protocol';
import { useState, type FormEvent } from 'react';

import { t } from '../i18n/index.js';

interface SetupRouteProps {
  error: string | null;
  pending: boolean;
  onSetup: (username: string, password: string) => void;
}

/** Longest username the server takes (`SetupRequestSchema`). */
const MAX_USERNAME_LENGTH = 40;

/**
 * First run of the desktop app: the server has no GM yet, so instead of a login
 * there is this — the owner chooses the GM's username and password. Shown only
 * while the server says so (`GET /setup`); it refuses a second time on its own.
 */
export function SetupRoute({ error, pending, onSetup }: SetupRouteProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');

  const tooShort = password !== '' && password.length < MIN_PASSWORD_LENGTH;
  const mismatched = repeated !== '' && repeated !== password;
  const ready =
    !pending &&
    username.trim() !== '' &&
    username.trim().length <= MAX_USERNAME_LENGTH &&
    password.length >= MIN_PASSWORD_LENGTH &&
    repeated === password;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onSetup(username.trim(), password);
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <form className="panel" onSubmit={submit}>
          <p className="login-overline">{t('setup.overline')}</p>
          <h1>{t('setup.title')}</h1>
          <p className="muted mt-3">{t('setup.description')}</p>

          <label htmlFor="setup-username" className="mt-4">
            {t('common.username')}
          </label>
          <input
            id="setup-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_USERNAME_LENGTH}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t('common.usernamePlaceholder')}
          />
          <label htmlFor="setup-password" className="mt-3">
            {t('login.password')}
          </label>
          <input
            id="setup-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="setup-password-hint"
          />
          <p className="muted" id="setup-password-hint">
            {t('changePassword.minLength', { min: MIN_PASSWORD_LENGTH })}
          </p>
          <label htmlFor="setup-repeat" className="mt-3">
            {t('changePassword.repeat')}
          </label>
          <input
            id="setup-repeat"
            name="repeat-password"
            type="password"
            autoComplete="new-password"
            value={repeated}
            onChange={(event) => setRepeated(event.target.value)}
          />

          {tooShort ? (
            <div className="errors mt-3" role="alert">
              {t('changePassword.tooShort', { min: MIN_PASSWORD_LENGTH })}
            </div>
          ) : null}
          {mismatched ? (
            <div className="errors mt-3" role="alert">
              {t('changePassword.mismatch')}
            </div>
          ) : null}
          {error !== null ? (
            <div className="errors mt-3" role="alert">
              {error}
            </div>
          ) : null}

          <div className="mt-4">
            <button type="submit" className="btn-primary" disabled={!ready}>
              {pending ? t('setup.submitting') : t('setup.submit')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
