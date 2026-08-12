import { useState } from 'react';

interface ChangePasswordRouteProps {
  error: string | null;
  onChange: (currentPassword: string, newPassword: string) => void;
}

/** Forced screen right after login when the account's password is still the GM-set one. */
export function ChangePasswordRoute({ error, onChange }: ChangePasswordRouteProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  return (
    <section>
      <div className="hero">
        <h1>Cambia tu contraseña</h1>
        <p className="muted">Tu DJ creó esta cuenta con una contraseña inicial. Elige una nueva.</p>
      </div>
      <div className="panel">
        <label htmlFor="current-password">Contraseña actual</label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <label htmlFor="new-password" className="mt-3">
          Contraseña nueva
        </label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <div className="mt-3">
          <button
            type="button"
            disabled={currentPassword === '' || newPassword === ''}
            onClick={() => onChange(currentPassword, newPassword)}
          >
            Guardar contraseña
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </div>
    </section>
  );
}
