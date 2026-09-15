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
import { t, type MessageKey } from '../i18n/index.js';
import { createSheet } from '../state/sheet.js';
import { useCreation } from '../state/useCreation.js';

const STEP_TITLE_KEYS: Record<Step, MessageKey> = {
  1: 'wizard.stepTitle.1',
  2: 'wizard.stepTitle.2',
  3: 'wizard.stepTitle.3',
  4: 'wizard.stepTitle.4',
  5: 'wizard.stepTitle.5',
  6: 'wizard.stepTitle.6',
  7: 'wizard.stepTitle.7',
  8: 'wizard.stepTitle.8',
  9: 'wizard.stepTitle.9',
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
   * can re-enable instead of being stuck on the saving label forever. */
  error: string | null;
}

/** The nine-step creation wizard: one route per step, always for one specific campaign. */
export function WizardRoute({ storage, campaignId, onFinish, onClaim, claimed, error }: WizardRouteProps) {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, discard, reset } = useCreation(storage, campaignId);
  // Set once the finish button is clicked; stays true until the server confirms (or the
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

  // A rejection re-enables the button instead of leaving it stuck on the saving label
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
        <h1>{t('wizard.stepHeading', { step, title: t(STEP_TITLE_KEYS[step]) })}</h1>
        <button
          type="button"
          onClick={() => {
            reset();
            navigate('/create/1');
          }}
        >
          {t('wizard.startOver')}
        </button>
      </div>

      <ol className="steps" aria-label={t('wizard.progressLabel')}>
        {STEPS.map((s) => {
          const done = validateStep(state, s).ok;
          return (
            <li key={s}>
              <button
                type="button"
                className="step-pip"
                data-state={s === step ? 'current' : done ? 'done' : 'todo'}
                aria-current={s === step ? 'step' : undefined}
                aria-label={t('wizard.stepPipLabel', {
                  step: s,
                  title: t(STEP_TITLE_KEYS[s]),
                  done: done ? t('wizard.stepPipDoneSuffix') : '',
                })}
                onClick={() => goTo(s)}
              >
                <span className="step-pip-diamond">
                  <span className="step-pip-num">{done && s !== step ? '✓' : s}</span>
                </span>
                <span className="step-pip-label">{t(STEP_TITLE_KEYS[s])}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="panel">
        {step === 1 ? (
          <TextField
            id="character-name"
            label={t('wizard.nameLabel')}
            value={state.name ?? ''}
            onChange={(name) => dispatch({ type: 'setName', name })}
          />
        ) : null}

        <StepComponent state={state} dispatch={dispatch} errors={validation.errors} />
      </div>

      <ErrorSummary errors={validation.errors} />

      <div className="row spread">
        <button type="button" disabled={step === 1} onClick={() => goTo((step - 1) as Step)}>
          {t('wizard.back')}
        </button>

        {isLast ? (
          <button type="button" className="btn-primary" disabled={!allValid || submitting} onClick={finish}>
            {submitting ? t('wizard.saving') : t('wizard.finish')}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={!validation.ok}
            onClick={() => goTo((step + 1) as Step)}
          >
            {t('wizard.next')}
          </button>
        )}
      </div>

      {isLast && !allValid ? <p className="muted mt-3">{t('wizard.incompleteStepsHint')}</p> : null}
    </section>
  );
}
