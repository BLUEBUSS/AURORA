import { expect, it } from "vitest";
import { inferCompany } from "./demo";
it("keeps a single-company identity but uses a generic identity for comparisons", () => {
  expect(inferCompany("NVIDIA（NVDA）与英伟达的利润")?.ticker).toBe("NVDA");
  expect(inferCompany("Broadcom（AVGO）与 Marvell（MRVL）")).toBeUndefined();
  expect(inferCompany("Microsoft 与 Amazon")).toBeUndefined();
  expect(inferCompany("AI 产业链")).toBeUndefined();
});
