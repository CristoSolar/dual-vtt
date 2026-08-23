import { useState } from 'react';

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
              <span className="login-art-overline">Daggerheart VTT</span>
            </div>
            <h1 className="login-art-headline">Tu mesa te espera del otro lado de la puerta.</h1>
            <p className="muted">
              Hojas sincronizadas, mapa compartido y las tiradas de dualidad a la vista de todos.
            </p>
          </div>

          <div className="login-form">
            <div>
              <p className="login-overline">Entrar</p>
              <h2 className="login-headline">Volvé a la campaña</h2>
            </div>

            <label htmlFor="login-username">Usuario</label>
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
            {error !== null ? <div className="errors mt-3">{error}</div> : null}
            <button
              type="button"
              className="btn-primary mt-4"
              disabled={pending || username.trim() === '' || password === ''}
              onClick={submit}
            >
              {pending ? 'Entrando…' : 'Entrar a la mesa'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
