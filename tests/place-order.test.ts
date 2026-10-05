import test from "node:test";
import assert from "node:assert/strict";
import { orderPlaces } from "../apps/web/src/place-order";
const places = [
  { id: "project", type: "Project" },
  { id: "custom", type: "Department" },
  { id: "initiative", type: "Initiative" },
  { id: "team", type: "Team" },
];
test("grouping puts teams and custom types above projects and initiatives", () => {
  assert.deepEqual(
    orderPlaces(places, [], true).map((p) => p.id),
    ["custom", "team", "project", "initiative"],
  );
});
test("grouping preserves saved order within each group and ungrouping restores manual order", () => {
  const saved = ["initiative", "team", "project", "custom"];
  assert.deepEqual(
    orderPlaces(places, saved, true).map((p) => p.id),
    ["team", "custom", "initiative", "project"],
  );
  assert.deepEqual(
    orderPlaces(places, saved, false).map((p) => p.id),
    saved,
  );
  assert.deepEqual(
    places.map((p) => p.id),
    ["project", "custom", "initiative", "team"],
  );
});
