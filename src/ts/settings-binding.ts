import type {Config} from './types.js';

/**
 * Declarative binding of Settings controls to the config tree.
 *
 * A control edits one node of the `Config` tree. A {@link ConfigField} pairs the
 * control with that node: `read` pulls the control's value out (in config
 * shape), `write` pushes a config value back in (read-back). A
 * {@link SettingsBinder} holds the field table and makes the two passes over
 * it, so a pane declares each binding once instead of hand-writing a save line
 * (and often a sync handler) per control.
 *
 * Derived or asynchronous fields (URL checks, the weather place, the USB scan,
 * the AI keys) stay out of the table and register an explicit {@link ConfigHook}
 * instead.
 */

/** A config value that a control can hold. */
export type FieldValue = string | number | boolean | null | string[];

/** One row of the field table: a control and the config path it edits. */
export interface ConfigField {
  readonly path: string;
  /** The control's current value, in the shape the config stores. */
  read(): FieldValue;
  /** Push a config value into the control (read-back). */
  write(value: unknown): void;
}

/** An explicit save step for a derived / asynchronous field. */
export type ConfigHook = (config: Config) => void;

/** A field table plus the read-back and save passes over it. */
export interface SettingsBinder {
  readonly fields: ConfigField[];
  /** Add a field and immediately push its config value into the control. */
  bind(field: ConfigField): void;
  /** Add a field whose control is already initialised by hand (derived init). */
  add(field: ConfigField): void;
  /** Add an explicit save step, run after the plain fields are collected. */
  hook(collect: ConfigHook): void;
  /** Push the whole config tree into the bound controls. */
  readInto(config: Config): void;
  /** Pull every bound control, then run the hooks, into `config`. */
  collect(config: Config): void;
}

/** Read `path` (a dotted path) off a plain-object tree. */
export function getPathValue(tree: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = tree;
  for (let i = 0; i < parts.length; i += 1) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  return cur;
}

/** Write `value` at `path` (a dotted path), creating missing parents. */
export function setPathValue(tree: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = tree as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Build a field table over `readSource`: `bind` reads its values into the
 * controls as they are created, so the pane shows what is configured. `collect`
 * writes the controls back into the live config on Save.
 */
export function createBinder(readSource: Config): SettingsBinder {
  const fields: ConfigField[] = [];
  const hooks: ConfigHook[] = [];

  return {
    fields: fields,
    bind: function (field: ConfigField): void {
      fields.push(field);
      field.write(getPathValue(readSource, field.path));
    },
    add: function (field: ConfigField): void {
      fields.push(field);
    },
    hook: function (collect: ConfigHook): void {
      hooks.push(collect);
    },
    readInto: function (config: Config): void {
      fields.forEach(function (field: ConfigField) {
        field.write(getPathValue(config, field.path));
      });
    },
    collect: function (config: Config): void {
      fields.forEach(function (field: ConfigField) {
        setPathValue(config, field.path, field.read());
      });
      hooks.forEach(function (collect: ConfigHook) { collect(config); });
    }
  };
}

/** A one-off field, for a derived control the adapters below do not cover. */
export function field(
  path: string,
  io: {read(): FieldValue; write(value: unknown): void}
): ConfigField {
  return {path: path, read: io.read, write: io.write};
}

/** A checkbox bound to a boolean config path. */
export function toggleField(input: HTMLInputElement, path: string): ConfigField {
  return {
    path: path,
    read: function () { return input.checked; },
    write: function (value) { input.checked = !!value; }
  };
}

/** How a text / stepper control's string maps to and from its config value. */
export interface FieldCodec {
  parse?(raw: string): FieldValue;
  format?(value: unknown): string;
  /** Trim the value before parsing (text fields). */
  trim?: boolean;
}

function formatValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** A text field (or textarea) bound to a config path. */
export function textField(
  input: HTMLInputElement | HTMLTextAreaElement,
  path: string,
  codec?: FieldCodec
): ConfigField {
  const parse = codec && codec.parse;
  const format = codec && codec.format;
  const trim = !!(codec && codec.trim);
  return {
    path: path,
    read: function () {
      const raw = trim ? input.value.trim() : input.value;
      return parse ? parse(raw) : raw;
    },
    write: function (value) {
      input.value = format ? format(value) : formatValue(value);
    }
  };
}

/** The value-carrying part of a createOptionStepper control. */
export interface StepperLike {
  readonly value: string;
  setValue(value: string): void;
}

/** An option stepper bound to a config path. */
export function stepperField(
  el: StepperLike,
  path: string,
  codec?: FieldCodec
): ConfigField {
  const parse = codec && codec.parse;
  const format = codec && codec.format;
  return {
    path: path,
    read: function () { return parse ? parse(el.value) : el.value; },
    write: function (value) {
      el.setValue(format ? format(value) : formatValue(value));
    }
  };
}
