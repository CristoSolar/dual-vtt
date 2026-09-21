import { MIN_PASSWORD_LENGTH } from '@daggerheart/protocol';
import { useState, type FormEvent } from 'react';

import { t } from '../i18n/index.js';

interface ChangePasswordRouteProps {
  error: string | null;
  pending: boolean;
  onChange: (currentPassword: string, newPassword: string) => void;
}

/** Forced screen right after login when the account's password is still the GM-set one. */
export function ChangePasswordRoute({ error, pending, onChange }: ChangePasswordRouteProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeated, setRepeated] = useState('');

  // The two client-side checks the server also makes, said before the round trip
  // rather than after it.
  const tooShort = newPassword !== '' && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatched = repeated !== '' && repeated !== newPassword;
  const ready =
    !pending &&
    currentPassword !== '' &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    repeated === newPassword;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onChange(currentPassword, newPassword);
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <form className="panel" onSubmit={submit}>
          <h1>{t('changePassword.title')}</h1>
          <p className="muted mt-3">{t('changePassword.description')}</p>

          <label htmlFor="current-password" className="mt-4">
            {t('changePassword.current')}
          </label>
          <input
            id="current-password"
            name="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor="new-password" className="mt-3">
            {t('changePassword.new')}
          </label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-describedby="new-password-hint"
          />
          <p className="muted" id="new-password-hint">
            {t('changePassword.minLength', { min: MIN_PASSWORD_LENGTH })}
          </p>

          <label htmlFor="repeat-password" className="mt-3">
            {t('changePassword.repeat')}
          </label>
          <input
            id="repeat-password"
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

          <div className="mt-4">
            <button type="submit" disabled={!ready}>
              {pending ? t('changePassword.saving') : t('changePassword.save')}
            </button>
          </div>
          {error !== null ? (
            <div className="errors" role="alert">
              {error}
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
