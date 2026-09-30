/**
 * The Behaviors canvas's dropdown: the app's CustomSelect (the one behind the
 * model picker) behind the same props as the UI kit's native `Select` --
 * `{ value, label }` options and an `onChange` reading `event.target.value` --
 * so the inspectors get the app's dropdown styling without changing how they
 * read.
 */

import React from "react";
import { CustomSelect } from "../../CustomSelect";

export interface Choice {
  value: string;
  label: string;
}

interface SelectProps {
  /** Pass the surrounding `Field`'s id so its label points at the trigger. */
  id?: string;
  value: string;
  options: Choice[];
  onChange: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Names the control when there is no visible `Field` label. */
  "aria-label"?: string;
}

export const Select: React.FC<SelectProps> = ({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  className = "",
  "aria-label": ariaLabel,
}) => (
  <div role="group" aria-label={ariaLabel} className={className} style={{ minWidth: 0 }}>
    <CustomSelect
      id={id}
      value={value}
      onChange={(selected) => onChange({ target: { value: selected } })}
      disabled={disabled}
      placeholder={placeholder}
      options={options.map((option) => ({ id: option.value, name: option.label }))}
    />
  </div>
);
