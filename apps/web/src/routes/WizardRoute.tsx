import { finalize, STEPS, validateStep, type Step } from '@daggerheart/character';
import type { Avatar } from '@daggerheart/protocol';
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
import { AvatarPicker } from '../components/avatar/AvatarPicker.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CreationSummary } from '../components/wizard/CreationSummary.js';
import { ErrorSummary, TextField } from '../components/wizard/StepFields.js';
import { t, type MessageKey } from '../i18n/index.js';
import { fitAvatar, loadDraftAvatar, saveDraftAvatar } from '../state/avatar.js';
import { DRAFT_SCOPE } from '../state/library.js';
import { createSheet, type SheetState } from '../state/sheet.js';
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
  /** Saves the finished character to the account's library. Resolves true once
   * the server has it; false leaves the draft in place to try again. */
  onSave: (sheet: SheetState) => Promise<boolean>;
  onFinish: () => void;
  /** For uploading an avatar picture. */
  authToken: string | null;
}

/**
 * The nine-step creation wizard: one route per step. The draft lives in this
 * browser until the character is finished; then it goes to the account's library,
 * not to any campaign — linking is a separate, later choice.
 */
export function WizardRoute({ storage, onSave, onFinish, authToken }: WizardRouteProps) {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, discard, reset } = useCreation(storage, DRAFT_SCOPE);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // The portrait is not one of the nine steps: optional, and never blocks finishing.
  const [avatar, setAvatar] = useState<Avatar | null>(() => loadDraftAvatar(storage, DRAFT_SCOPE));
  useEffect(() => saveDraftAvatar(storage, DRAFT_SCOPE, avatar), [storage, avatar]);

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

  // The draft is cleared only once the server has the character; a failure (shown
  // by the library's error) leaves this screen and the draft exactly as they were.
  const finish = () => {
    const character = finalize(state);
    const sheet = createSheet(character, {
      transformation: state.transformation,
      avatar: fitAvatar(avatar, character.heritage),
    });
    setSubmitting(true);
    void onSave(sheet).then((saved) => {
      setSubmitting(false);
      if (!saved) return;
      discard();
      saveDraftAvatar(storage, DRAFT_SCOPE, null);
      onFinish();
    });
  };

  return (
    <section>
      <div className="card-head">
        <h1>{t('wizard.stepHeading', { step, title: t(STEP_TITLE_KEYS[step]) })}</h1>
        <button type="button" onClick={() => setConfirmingReset(true)}>
          {t('wizard.startOver')}
        </button>
      </div>

      {confirmingReset ? (
        <ConfirmDialog
          title={t('wizard.startOver')}
          body={t('wizard.startOverConfirm')}
          confirmLabel={t('wizard.startOver')}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={() => {
            setConfirmingReset(false);
            reset();
            setAvatar(null);
            navigate('/create/1');
          }}
        />
      ) : null}

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

      {isLast && state.heritage !== null ? (
        <div className="panel">
          <p className="muted">{t('avatar.wizardHint')}</p>
          <AvatarPicker
            heritage={state.heritage}
            value={fitAvatar(avatar, state.heritage)}
            onChange={setAvatar}
            authToken={authToken}
          />
        </div>
      ) : null}

      {isLast ? <CreationSummary state={state} /> : null}

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
