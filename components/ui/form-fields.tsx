"use client";

import { Input, Label, TextField } from "@heroui/react";

type BaseFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
};

export function AppInputField({
  label,
  value,
  onChange,
  placeholder,
  className,
  type = "text",
}: BaseFieldProps) {
  return (
    <TextField
      name={label}
      value={value}
      onChange={onChange}
      className={className}
    >
      <Label className="text-xs font-semibold text-app">{label}</Label>
      <Input type={type} placeholder={placeholder} className="text-sm" />
    </TextField>
  );
}

type SelectOption = { value: string; label: string };

type AppSelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
};

export function AppSelectField({
  label,
  value,
  onChange,
  options,
  className,
}: AppSelectFieldProps) {
  return (
    <label className={`space-y-1 text-xs text-app ${className ?? ""}`}>
      <span className="font-semibold">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
