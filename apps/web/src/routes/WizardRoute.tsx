import { finalize, STEPS, validateStep, type Step } from '@daggerheart/character';
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
import { useCreation } from '../state/useCreation.js';

const STEP_TITLES: Record<Step, string> = {
  1: 'Class & Subclass',
  2: 'Heritage',
  3: 'Traits',
  4: 'Derived Stats',
  5: 'Equipment',
  6: 'Background',
  7: 'Experiences',
  8: 'Domain Cards',
  9: 'Connections',
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
  onFinish: (characterId: string) => void;
  addCharacter: (character: ReturnType<typeof finalize>) => string;
}

/** The nine-step creation wizard: one route per step. */
export function WizardRoute({ storage, onFinish, addCharacter }: WizardRouteProps) {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, discard, reset } = useCreation(storage);

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
    const id = addCharacter(character);
    discard();
    onFinish(id);
  };

  return (
    <section>
      <div className="card-head">
        <h1>
          Step {step} — {STEP_TITLES[step]}
        </h1>
        <button
          type="button"
          onClick={() => {
            reset();
            navigate('/create/1');
          }}
        >
          Start over
        </button>
      </div>

      <ol className="steps" aria-label="Creation progress">
        {STEPS.map((s) => {
          const done = validateStep(state, s).ok;
          return (
            <li key={s}>
              <button
                type="button"
                className="step-pip"
                data-state={s === step ? 'current' : done ? 'done' : 'todo'}
                aria-current={s === step ? 'step' : undefined}
                aria-label={`Step ${s}: ${STEP_TITLES[s]}${done ? ' (complete)' : ''}`}
                onClick={() => goTo(s)}
              >
                {s}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="panel">
        {step === 1 ? (
          <TextField
            id="character-name"
            label="Name (you can fill this in at any point)"
            value={state.name ?? ''}
            onChange={(name) => dispatch({ type: 'setName', name })}
          />
        ) : null}

        <StepComponent state={state} dispatch={dispatch} errors={validation.errors} />
      </div>

      <ErrorSummary errors={validation.errors} />

      <div className="row spread">
        <button type="button" disabled={step === 1} onClick={() => goTo((step - 1) as Step)}>
          ← Back
        </button>

        {isLast ? (
          <button type="button" disabled={!allValid} onClick={finish}>
            Finish & open sheet
          </button>
        ) : (
          <button
            type="button"
            disabled={!validation.ok}
            onClick={() => goTo((step + 1) as Step)}
          >
            Next →
          </button>
        )}
      </div>

      {isLast && !allValid ? (
        <p className="muted mt-3">
          Some earlier steps are still incomplete — the numbered buttons above show which.
        </p>
      ) : null}
    </section>
  );
}
