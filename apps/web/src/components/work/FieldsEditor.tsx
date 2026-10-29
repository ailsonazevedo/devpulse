"use client";

import type { WorkField, WorkFieldValue } from "@devpulse/core/work";

export type FieldValues = Record<string, WorkFieldValue>;

/** Valores atuais dos campos, indexados pelo id. */
export function fieldValuesOf(fields: WorkField[]): FieldValues {
  return Object.fromEntries(fields.map((f) => [f.id, f.value]));
}

const same = (a: WorkFieldValue | undefined, b: WorkFieldValue | undefined) =>
  (a ?? null) === (b ?? null) || String(a ?? "") === String(b ?? "");

/** Só os campos alterados em relação a `fields` (evita sobrescrever edições no provedor). */
export function changedFields(fields: WorkField[], values: FieldValues): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) {
    if (f.id in values && !same(values[f.id], f.value)) out[f.id] = values[f.id] ?? null;
  }
  return out;
}

/** Só os campos preenchidos (criação: vazio = deixar o padrão do provedor). */
export function filledFields(values: FieldValues): FieldValues {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== null && v !== ""),
  );
}

/**
 * Campos além do básico (tipo, prioridade, esforço, iteração, milestone,
 * campos de Project…), agrupados como o provedor os organiza.
 */
export function FieldsEditor({
  fields,
  values,
  onChange,
  disabled = false,
  skip = [],
}: {
  fields: WorkField[];
  values: FieldValues;
  onChange: (id: string, value: WorkFieldValue) => void;
  disabled?: boolean;
  /** ids exibidos em outro lugar (ex.: "type"). */
  skip?: string[];
}) {
  // Seleção sem nenhuma opção (ex.: campo de Project sem valores cadastrados) não tem o que editar.
  const shown = fields.filter(
    (f) =>
      !skip.includes(f.id) &&
      !(f.type === "single_select" && (f.options ?? []).length === 0 && f.value === null),
  );
  if (shown.length === 0) return null;

  const groups = new Map<string, WorkField[]>();
  for (const f of shown) {
    const g = f.group ?? "";
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }

  return (
    <div className="flex flex-col gap-3">
      {[...groups].map(([group, list]) => (
        <fieldset key={group} className="flex flex-col gap-2">
          {group && (
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              {group}
            </legend>
          )}
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            {list.map((f) => (
              <FieldInput
                key={f.id}
                field={f}
                value={f.id in values ? (values[f.id] ?? null) : f.value}
                onChange={(v) => onChange(f.id, v)}
                disabled={disabled}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: WorkField;
  value: WorkFieldValue;
  onChange: (v: WorkFieldValue) => void;
  disabled: boolean;
}) {
  const label = (
    <span className="flex items-center gap-1">
      {field.name}
      {field.required && <span className="text-red-500">*</span>}
    </span>
  );
  const cls = "input py-1.5 text-sm font-normal";

  if (field.type === "single_select") {
    const options = field.options ?? [];
    const current = value === null ? "" : String(value);
    const color = options.find((o) => o.id === current)?.color;
    return (
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-neutral-500">
        {label}
        <span className="relative flex items-center">
          {color && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-2.5 h-2.5 w-2.5 rounded-full"
              style={{ background: color }}
            />
          )}
          <select
            value={current}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
            disabled={disabled}
            className={cls + " w-full min-w-0" + (color ? " pl-7" : "")}
          >
            {(!field.required || current === "") && <option value="">—</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id} title={o.description ?? undefined}>
                {o.name}
                {o.description && /^\d{4}-\d{2}-\d{2}$/.test(o.description)
                  ? ` (${o.description})`
                  : ""}
              </option>
            ))}
          </select>
        </span>
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-neutral-500">
        {label}
        <input
          type="number"
          step="any"
          inputMode="decimal"
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
          placeholder={field.hint ?? undefined}
          className={cls}
        />
      </label>
    );
  }

  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-neutral-500">
      {label}
      <input
        type={field.type === "date" ? "date" : "text"}
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        disabled={disabled}
        placeholder={field.hint ?? undefined}
        className={cls}
      />
    </label>
  );
}
