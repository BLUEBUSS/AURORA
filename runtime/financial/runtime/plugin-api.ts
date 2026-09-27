import { Type } from "@sinclair/typebox";

export interface AgentToolLogger {
  error(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
}

/** Minimal runtime surface required by the tool factories. */
export interface AgentToolApi {
  logger: AgentToolLogger;
}

/** Minimal per-call context used by tools that persist agent-scoped state. */
export interface AgentToolContext {
  agentId?: string;
}

type StringEnumOptions<T extends readonly string[]> = {
  description?: string;
  title?: string;
  default?: T[number];
};

export function stringEnum<T extends readonly string[]>(
  values: T,
  options: StringEnumOptions<T> = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

export function optionalStringEnum<T extends readonly string[]>(
  values: T,
  options: StringEnumOptions<T> = {},
) {
  return Type.Optional(stringEnum(values, options));
}
