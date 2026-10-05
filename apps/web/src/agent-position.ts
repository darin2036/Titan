// Position is the top-left corner of the launcher; the panel opens above it.
export function clampAgentPosition(
  position: { x: number; y: number },
  viewport: { width: number; height: number },
  open: boolean,
) {
  const panelWidth = Math.min(360, viewport.width - 24);
  const panelHeight = Math.min(520, viewport.height - 100);
  const minX = open ? panelWidth - 40 : 12;
  const minY = open ? panelHeight + 24 : 12;
  return {
    x: Math.max(minX, Math.min(position.x, viewport.width - 64)),
    y: Math.max(minY, Math.min(position.y, viewport.height - 64)),
  };
}
