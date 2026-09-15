import { useState } from 'react';

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

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="panel">
          <h1>{t('changePassword.title')}</h1>
          <p className="muted mt-3">{t('changePassword.description')}</p>

          <label htmlFor="current-password" className="mt-4">
            {t('changePassword.current')}
          </label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor="new-password" className="mt-3">
            {t('changePassword.new')}
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div className="mt-4">
            <button
              type="button"
              disabled={pending || currentPassword === '' || newPassword === ''}
              onClick={() => onChange(currentPassword, newPassword)}
            >
              {pending ? t('changePassword.saving') : t('changePassword.save')}
            </button>
          </div>
          {error !== null ? <div className="errors">{error}</div> : null}
        </div>
      </section>
    </div>
  );
}
