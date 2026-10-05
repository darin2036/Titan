import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampAgentPosition } from "./agent-position";

function visibleViewport() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}

export default function FloatingAgent({
  open,
  onOpen,
  onClose,
  selection,
  subtitle,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  selection: boolean;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [viewport, setViewport] = useState(visibleViewport);
  const [position, setPosition] = useState(() => ({
    x: viewport.left + viewport.width - 76,
    y: viewport.top + viewport.height - 76,
  }));
  const launcher = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    origin: typeof position;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const fit = (p: typeof position) =>
    clampAgentPosition(p, visibleViewport(), open);
  const fittedPosition = clampAgentPosition(position, viewport, open);
  useLayoutEffect(() => {
    const resize = () => {
      const next = visibleViewport();
      setViewport(next);
      setPosition((p) => clampAgentPosition(p, next, open));
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [open]);
  function close() {
    onClose();
    launcher.current?.focus();
  }
  const movement = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest(".agent-minimize")
      )
        return;
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        origin: fittedPosition,
        moved: false,
      };
      suppressClick.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const start = drag.current;
      if (!start) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) start.moved = true;
      if (start.moved)
        setPosition(fit({ x: start.origin.x + dx, y: start.origin.y + dy }));
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      suppressClick.current =
        e.currentTarget === launcher.current && (drag.current?.moved ?? false);
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel() {
      drag.current = null;
      suppressClick.current = false;
    },
  };
  return createPortal(
    <div
      className="floating-agent"
      style={{ left: fittedPosition.x, top: fittedPosition.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <aside
        className="conversation"
        id="workspace-agent"
        aria-label="Workspace agent"
        hidden={!open}
        style={{
          width: Math.min(360, viewport.width - 24),
          height: Math.min(520, viewport.height - 100),
        }}
      >
        <div className="conversation-heading" {...movement}>
          <span className="agent-icon" aria-hidden="true">
            ✳
          </span>
          <div className="agent-heading-copy">
            <strong>Your agent</strong>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <span className="agent-grip" aria-hidden="true">
            ⠿
          </span>
          <button
            type="button"
            className="agent-minimize"
            aria-label="Minimize agent"
            onClick={close}
          >
            −
          </button>
        </div>
        {children}
      </aside>
      <button
        ref={launcher}
        type="button"
        className="agent-launcher"
        {...movement}
        aria-label={open ? "Close agent" : "Open agent"}
        aria-expanded={open}
        aria-controls="workspace-agent"
        title="Ask your agent · drag to move, or use arrow keys"
        onKeyDown={(e) => {
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-24, 0],
            ArrowRight: [24, 0],
            ArrowUp: [0, -24],
            ArrowDown: [0, 24],
          };
          if (delta[e.key]) {
            e.preventDefault();
            const [x, y] = delta[e.key];
            setPosition((p) => fit({ x: p.x + x, y: p.y + y }));
          }
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          open ? close() : onOpen();
        }}
      >
        <span aria-hidden="true">{open ? "×" : "✳"}</span>
        {selection && (
          <span
            className="selection-dot"
            aria-label="Selected passage attached"
          />
        )}
      </button>
    </div>,
    document.body,
  );
}
