import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { validate } from "../scripts/validate";

test("the bundled example stays complete and its source links resolve", async () => {
  const result = await validate(resolve(import.meta.dir, "../examples/greeting"));
  expect(result.steps).toBe(4);
  expect(result.files).toBe(4);
});
