// Position is the top-left corner of the launcher; the panel opens above it.
export function clampAgentPosition(
  position: { x: number; y: number },
  viewport: { width: number; height: number; left?: number; top?: number },
  open: boolean,
) {
  const panelWidth = Math.min(360, viewport.width - 24);
  const panelHeight = Math.min(520, viewport.height - 100);
  const minX = open ? panelWidth - 40 : 12;
  const minY = open ? panelHeight + 24 : 12;
  const left = viewport.left ?? 0;
  const top = viewport.top ?? 0;
  return {
    x: left + Math.max(minX, Math.min(position.x - left, viewport.width - 64)),
    y: top + Math.max(minY, Math.min(position.y - top, viewport.height - 64)),
  };
}
