import { t } from '../i18n/index.js';

interface Option {
  id: string;
  name: string;
  meta?: string | undefined;
  /** Portrait path, e.g. `/images/classes/wizard.png`. Omit for options with no art. */
  image?: string | undefined;
}

interface OptionListProps {
  legend: string;
  options: readonly Option[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}

/**
 * A single-select list of choices. The caller passes options straight from
 * `availableOptions()`; this component never knows what an option means.
 */
export function OptionList({
  legend,
  options,
  selectedId,
  onSelect,
  emptyMessage = t('common.noOptionsAvailable'),
}: OptionListProps) {
  if (options.length === 0) {
    return (
      <fieldset>
        <legend>{legend}</legend>
        <p className="muted">{emptyMessage}</p>
      </fieldset>
    );
  }

  return (
    <fieldset>
      <legend>{legend}</legend>
      <ul className="options">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className="option"
              aria-pressed={option.id === selectedId}
              onClick={() => onSelect(option.id)}
            >
              {option.image ? (
                <img className="option-portrait" src={option.image} alt="" />
              ) : null}
              <span className="option-name">{option.name}</span>
              {option.meta ? <span className="option-meta">{option.meta}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
