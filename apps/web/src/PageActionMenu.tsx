import React, { useEffect, useRef } from "react";
export default function PageActionMenu({
  children,
}: {
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target) &&
        ref.current
      )
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details ref={ref} className="page-action-menu">
      <summary aria-label="Page actions" title="Page actions">
        ···
      </summary>
      <div
        className="page-action-options"
        role="group"
        aria-label="More page actions"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("button") &&
            ref.current
          )
            ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
