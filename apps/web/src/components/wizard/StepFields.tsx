import type { ValidationError } from '@daggerheart/character';

interface FieldErrorsProps {
  errors: readonly ValidationError[];
}

/** Inline errors for one field. */
export function FieldErrors({ errors }: FieldErrorsProps) {
  if (errors.length === 0) return null;
  return (
    <div className="field-error" role="alert">
      {errors.map((error) => (
        <div key={error.code}>{error.message}</div>
      ))}
    </div>
  );
}

interface ErrorSummaryProps {
  errors: readonly ValidationError[];
}

/** Everything still outstanding on this step. */
export function ErrorSummary({ errors }: ErrorSummaryProps) {
  if (errors.length === 0) return null;
  return (
    <div className="errors" role="alert">
      <strong>Not finished yet</strong>
      <ul>
        {errors.map((error) => (
          <li key={`${error.code}-${error.field ?? ''}`}>{error.message}</li>
        ))}
      </ul>
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  errors?: readonly ValidationError[];
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  errors = [],
}: TextFieldProps) {
  return (
    <div className="mb-4">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <FieldErrors errors={errors} />
    </div>
  );
}
