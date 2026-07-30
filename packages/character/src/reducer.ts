import { STEPS, type CreationAction, type CreationState, type Step } from './types.js';
import { validateStep } from './validate.js';

/** A blank creation, sitting on step 1. */
export function createInitialState(): CreationState {
  return withCompletion({
    currentStep: 1,
    completed: {},
    name: null,
    pronouns: null,
    classId: null,
    subclassId: null,
    heritage: null,
    communityId: null,
    traits: null,
    equipment: null,
    background: null,
    experiences: [],
    domainCardIds: [],
    connections: [],
  });
}

/** Recomputes the completion flags so they can never drift from `validateStep`. */
function withCompletion(state: CreationState): CreationState {
  const completed: Record<string, boolean> = {};
  for (const step of STEPS) completed[String(step)] = validateStep(state, step).ok;
  return { ...state, completed };
}

/** The first step that does not yet validate, or 9 once everything passes. */
function firstIncompleteStep(state: CreationState): Step {
  return STEPS.find((step) => !validateStep(state, step).ok) ?? 9;
}

/**
 * Applies one choice. Pure: returns a new state and never throws, so an invalid
 * choice simply lands in state and is reported by `validateStep` rather than being
 * silently dropped or coerced.
 */
export function applyChoice(state: CreationState, action: CreationAction): CreationState {
  const next = reduce(state, action);
  if (action.type === 'goToStep') return withCompletion(next);

  const advanced = withCompletion(next);
  return { ...advanced, currentStep: firstIncompleteStep(advanced) };
}

function reduce(state: CreationState, action: CreationAction): CreationState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.name };

    case 'setPronouns':
      return { ...state, pronouns: action.pronouns };

    case 'chooseClass':
      // A subclass belongs to one class, so switching class drops it, and with it any
      // domain cards and equipment that depended on the old class.
      return state.classId === action.classId
        ? state
        : {
            ...state,
            classId: action.classId,
            subclassId: null,
            domainCardIds: [],
            equipment: null,
          };

    case 'chooseSubclass':
      return { ...state, subclassId: action.subclassId };

    case 'chooseAncestry':
      return { ...state, heritage: { kind: 'single', ancestryId: action.ancestryId } };

    case 'chooseMixedAncestry':
      return {
        ...state,
        heritage: { kind: 'mixed', first: { ...action.first }, second: { ...action.second } },
      };

    case 'chooseCommunity':
      return { ...state, communityId: action.communityId };

    case 'assignTraits':
      return { ...state, traits: { ...action.traits } };

    case 'chooseEquipment':
      return { ...state, equipment: { ...action.equipment } };

    case 'setBackground':
      return { ...state, background: action.background };

    case 'setExperiences':
      return { ...state, experiences: action.experiences.map((e) => ({ ...e })) };

    case 'chooseDomainCards':
      return { ...state, domainCardIds: [...action.cardIds] };

    case 'setConnections':
      return { ...state, connections: action.connections.map((c) => ({ ...c })) };

    case 'goToStep':
      return { ...state, currentStep: action.step };
  }
}

/** True when every step validates, so `finalize` will succeed. */
export function isComplete(state: CreationState): boolean {
  return STEPS.every((step) => validateStep(state, step).ok);
}
