import test from "node:test";
import assert from "node:assert/strict";
import { clampAgentPosition } from "../apps/web/src/agent-position";

test("floating agent stays reachable after dragging or resizing", () => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 480 },
    { width: 240, height: 240 },
    { width: 320, height: 120 },
  ]) {
    for (const open of [true, false]) {
      for (const position of [
        { x: -1000, y: -1000 },
        { x: 10000, y: 10000 },
        { x: 420, y: 640 },
      ]) {
        const p = clampAgentPosition(position, viewport, open);
        assert.ok(p.x >= 12 && p.y >= 12);
        assert.ok(p.x + 52 <= viewport.width - 12);
        assert.ok(p.y + 52 <= viewport.height - 12);
        if (open) {
          assert.ok(p.x + 52 - Math.min(360, viewport.width - 24) >= 12);
          assert.ok(p.y - 12 - Math.min(520, viewport.height - 100) >= 12);
        }
      }
    }
  }
});

test("collapsed launcher can move freely; opening brings the whole panel into view", () => {
  const viewport = { width: 1280, height: 720 };
  const closed = clampAgentPosition({ x: 20, y: 20 }, viewport, false);
  assert.deepEqual(closed, { x: 20, y: 20 });
  const open = clampAgentPosition(closed, viewport, true);
  assert.ok(open.x >= 320 && open.y >= 544);
});

test("launcher and open panel fit the visible viewport after keyboard or zoom changes", () => {
  const viewport = { width: 390, height: 310, left: 24, top: 180 };
  for (const open of [false, true]) {
    const position = clampAgentPosition({ x: 1300, y: 900 }, viewport, open);
    assert.ok(position.x >= viewport.left + 12);
    assert.ok(position.y >= viewport.top + 12);
    assert.ok(position.x + 52 <= viewport.left + viewport.width - 12);
    assert.ok(position.y + 52 <= viewport.top + viewport.height - 12);
    if (open) {
      assert.ok(
        position.x + 52 - Math.min(360, viewport.width - 24) >=
          viewport.left + 12,
      );
      assert.ok(
        position.y - 12 - Math.min(520, viewport.height - 100) >=
          viewport.top + 12,
      );
    }
  }
});
