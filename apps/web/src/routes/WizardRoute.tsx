import { finalize, STEPS, validateStep, type Step } from '@daggerheart/character';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  StepBackground,
  StepClass,
  StepConnections,
  StepDerived,
  StepDomainCards,
  StepEquipment,
  StepExperiences,
  StepHeritage,
  StepTraits,
  type StepProps,
} from '../components/wizard/Steps.js';
import { ErrorSummary, TextField } from '../components/wizard/StepFields.js';
import { createSheet } from '../state/sheet.js';
import { useCreation } from '../state/useCreation.js';

const STEP_TITLES: Record<Step, string> = {
  1: 'Clase y Subclase',
  2: 'Herencia',
  3: 'Rasgos',
  4: 'Estadísticas derivadas',
  5: 'Equipo',
  6: 'Trasfondo',
  7: 'Experiencias',
  8: 'Cartas de Dominio',
  9: 'Conexiones',
};

const STEP_COMPONENTS: Record<Step, (props: StepProps) => JSX.Element> = {
  1: StepClass,
  2: StepHeritage,
  3: StepTraits,
  4: StepDerived,
  5: StepEquipment,
  6: StepBackground,
  7: StepExperiences,
  8: StepDomainCards,
  9: StepConnections,
};

const isStep = (value: number): value is Step => STEPS.includes(value as Step);

interface WizardRouteProps {
  storage: Storage;
  campaignId: string;
  onFinish: () => void;
  onClaim: (sheet: ReturnType<typeof createSheet>) => void;
  /** Whether the server has actually confirmed the claim (the character shows up
   * in the room state) — not just that we asked. */
  claimed: boolean;
  /** Set when the server rejects something — including our claim — so the button
   * can re-enable instead of being stuck on "Guardando…" forever. */
  error: string | null;
}

/** The nine-step creation wizard: one route per step, always for one specific campaign. */
export function WizardRoute({ storage, campaignId, onFinish, onClaim, claimed, error }: WizardRouteProps) {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, discard, reset } = useCreation(storage, campaignId);
  // Set once "Terminar" is clicked; stays true until the server confirms (or the
  // player navigates away and back). Only while true does a later `claimed` flip
  // mean "the claim we just sent" rather than some pre-existing state.
  const [submitting, setSubmitting] = useState(false);

  // Only clear the local draft and leave the wizard once the server has actually
  // confirmed the claim — sending the intent is not the same as it having landed.
  // A rejection (bad request, no seat, etc.) surfaces via the shared error toast
  // and leaves the draft and this screen exactly as they were, so the player can
  // just press the button again instead of having already lost their work.
  useEffect(() => {
    if (submitting && claimed) {
      discard();
      onFinish();
    }
  }, [submitting, claimed, discard, onFinish]);

  // A rejection re-enables the button instead of leaving it stuck on "Guardando…"
  // with no way to retry.
  useEffect(() => {
    if (submitting && !claimed && error !== null) setSubmitting(false);
  }, [submitting, claimed, error]);

  const parsed = Number(stepParam ?? '1');
  const step: Step = isStep(parsed) ? parsed : 1;

  const validation = validateStep(state, step);
  const StepComponent = STEP_COMPONENTS[step];
  const isLast = step === 9;
  const allValid = STEPS.every((s) => validateStep(state, s).ok);

  const goTo = (next: Step) => {
    dispatch({ type: 'goToStep', step: next });
    navigate(`/create/${next}`);
  };

  const finish = () => {
    const character = finalize(state);
    onClaim(createSheet(character));
    setSubmitting(true);
  };

  return (
    <section>
      <div className="card-head">
        <h1>
          Paso {step} — {STEP_TITLES[step]}
        </h1>
        <button
          type="button"
          onClick={() => {
            reset();
            navigate('/create/1');
          }}
        >
          Empezar de nuevo
        </button>
      </div>

      <ol className="steps" aria-label="Progreso de la creación">
        {STEPS.map((s) => {
          const done = validateStep(state, s).ok;
          return (
            <li key={s}>
              <button
                type="button"
                className="step-pip"
                data-state={s === step ? 'current' : done ? 'done' : 'todo'}
                aria-current={s === step ? 'step' : undefined}
                aria-label={`Paso ${s}: ${STEP_TITLES[s]}${done ? ' (completo)' : ''}`}
                onClick={() => goTo(s)}
              >
                <span className="step-pip-diamond">
                  <span className="step-pip-num">{done && s !== step ? '✓' : s}</span>
                </span>
                <span className="step-pip-label">{STEP_TITLES[s]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="panel">
        {step === 1 ? (
          <TextField
            id="character-name"
            label="Nombre (puedes completarlo en cualquier momento)"
            value={state.name ?? ''}
            onChange={(name) => dispatch({ type: 'setName', name })}
          />
        ) : null}

        <StepComponent state={state} dispatch={dispatch} errors={validation.errors} />
      </div>

      <ErrorSummary errors={validation.errors} />

      <div className="row spread">
        <button type="button" disabled={step === 1} onClick={() => goTo((step - 1) as Step)}>
          ← Atrás
        </button>

        {isLast ? (
          <button type="button" className="btn-primary" disabled={!allValid || submitting} onClick={finish}>
            {submitting ? 'Guardando…' : 'Terminar y abrir hoja'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={!validation.ok}
            onClick={() => goTo((step + 1) as Step)}
          >
            Siguiente →
          </button>
        )}
      </div>

      {isLast && !allValid ? (
        <p className="muted mt-3">
          Todavía hay pasos anteriores incompletos — los botones numerados de arriba indican cuáles.
        </p>
      ) : null}
    </section>
  );
}
