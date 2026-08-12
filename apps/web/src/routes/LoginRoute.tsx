import { useState } from 'react';

interface LoginRouteProps {
  error: string | null;
  onLogin: (username: string, password: string) => void;
}

/** The front door when nobody is logged in yet. Nothing past this point is reachable. */
export function LoginRoute({ error, onLogin }: LoginRouteProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    if (username.trim() === '' || password === '') return;
    onLogin(username.trim(), password);
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="panel">
          <h1>DAGGERHEART VTT</h1>
          <p className="muted mt-3">Ingresa con la cuenta que te dio tu DJ.</p>

          <label htmlFor="login-username" className="mt-4">
            Usuario
          </label>
          <input
            id="login-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="usuario"
          />
          <label htmlFor="login-password" className="mt-3">
            Contraseña
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
          <div className="mt-4">
            <button type="button" disabled={username.trim() === '' || password === ''} onClick={submit}>
              Entrar
            </button>
          </div>
          {error !== null ? <div className="errors">{error}</div> : null}
        </div>
      </section>
    </div>
  );
}
