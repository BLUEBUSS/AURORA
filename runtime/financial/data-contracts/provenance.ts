export const DATA_PROVENANCE_SCHEMA_VERSION = "fin-core.provenance.v1" as const;

export interface DataProvenance {
  schemaVersion: typeof DATA_PROVENANCE_SCHEMA_VERSION;
  source: string;
  mode: "fixture" | "live";
  asOf: string;
  coverage: string;
  retrievedAt?: string;
}
