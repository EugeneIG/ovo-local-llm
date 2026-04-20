// [START] Phase 8 — Draggable resize handle for panel splitting
import { useCallback, useRef } from "react";

interface ResizeHandleProps {
  /** "horizontal" splits left/right, "vertical" splits top/bottom */
  direction: "horizontal" | "vertical";
  /** Called with delta pixels while dragging */
  onResize: (delta: number) => void;
}

export function ResizeHandle({ direction, onResize }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastPos.current = direction === "horizontal" ? e.clientX : e.clientY;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const currentPos = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = currentPos - lastPos.current;
        lastPos.current = currentPos;
        onResize(delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction, onResize],
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`shrink-0 group ${
        isHorizontal
          ? "w-1 cursor-col-resize hover:bg-ovo-accent/30 active:bg-ovo-accent/50"
          : "h-1 cursor-row-resize hover:bg-ovo-accent/30 active:bg-ovo-accent/50"
      } transition-colors`}
    >
      {/* Visual indicator line on hover */}
      <div
        className={`${
          isHorizontal
            ? "w-px h-full mx-auto bg-ovo-border group-hover:bg-ovo-accent"
            : "h-px w-full my-auto bg-ovo-border group-hover:bg-ovo-accent"
        } transition-colors`}
      />
    </div>
  );
}
// [END] Phase 8
