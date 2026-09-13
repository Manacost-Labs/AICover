import React, { useId, useState } from "react";
import { Check } from "lucide-react";
import "../../styles/model-picker.css";

export interface ModelOption {
  id: string;
  name: string;
  providerName?: string;
  logoSrc?: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

function ModelLogo({ option }: { option: ModelOption }) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  return (
    <span className="model-picker__logo" aria-hidden="true">
      {option.logoSrc && failedSource !== option.logoSrc ? (
        <img
          src={option.logoSrc}
          alt=""
          width={28}
          height={28}
          onError={() => setFailedSource(option.logoSrc)}
        />
      ) : (
        <span>{(option.providerName || option.name).slice(0, 1)}</span>
      )}
    </span>
  );
}

/** Presentation only: model IDs, availability and size rules belong to callers. */
export function ModelPicker({
  label = "Модель",
  options,
  value,
  onChange,
  disabled = false,
}: {
  label?: string;
  options: readonly ModelOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const groupId = useId();
  const selected = options.find((option) => option.id === value);
  return (
    <fieldset className="model-picker" disabled={disabled}>
      <legend className="model-picker__legend">{label}</legend>
      <div className="model-picker__grid">
        {options.map((option, index) => {
          const unavailable = disabled || Boolean(option.disabled);
          const descriptionId = `${groupId}-description-${index}`;
          return (
            <label className="model-picker__option" key={option.id}>
              <input
                type="radio"
                name={groupId}
                value={option.id}
                checked={value === option.id}
                disabled={unavailable}
                aria-label={[option.providerName, option.name]
                  .filter(Boolean)
                  .join(" ")}
                aria-describedby={descriptionId}
                onChange={(event) => {
                  if (event.target.checked && !unavailable) onChange(option.id);
                }}
              />
              <span className="model-picker__tile">
                <span className="model-picker__top">
                  <ModelLogo option={option} />
                  <span className="model-picker__check" aria-hidden="true">
                    <Check size={12} strokeWidth={2.5} />
                  </span>
                </span>
                <span className="model-picker__name">
                  {option.name}
                  <span className="model-picker__provider">
                    {option.providerName}
                  </span>
                </span>
              </span>
              <span className="model-picker__sr-only" id={descriptionId}>
                {option.disabledReason || option.description || ""}
              </span>
            </label>
          );
        })}
      </div>
      <p className="model-picker__description" aria-live="polite">
        {selected?.disabledReason ||
          selected?.description ||
          (selected ? " " : "Выберите модель для обработки.")}
      </p>
    </fieldset>
  );
}
