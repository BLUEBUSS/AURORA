import { Type } from "typebox";
// Adapted from OpenClaw's schema/typebox helper; retain flat provider-compatible enums.
export function stringEnum<T extends readonly string[]>(values: T, options: { description?: string } = {}) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}
export function optionalStringEnum<T extends readonly string[]>(values: T, options: { description?: string } = {}) {
  return Type.Optional(stringEnum(values, options));
}
