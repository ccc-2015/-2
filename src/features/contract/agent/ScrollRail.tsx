import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface RailState {
  visible: boolean;
  top: number;
  height: number;
  track: number;
}

/** 右侧短滚动条：轨道在输入框上方结束，拖动块最长 120px。 */
export function ScrollRail({
  targetRef,
  bottomOffset,
}: {
  targetRef: RefObject<HTMLDivElement | null>;
  bottomOffset: number;
}) {
  const [state, setState] = useState<RailState>({ visible: false, top: 0, height: 0, track: 0 });
  const drag = useRef<{ startY: number; startTop: number } | null>(null);

  const sync = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const view = el.clientHeight;
    const total = el.scrollHeight;
    const track = Math.max(0, view - bottomOffset);
    if (track < 96 || total <= view + 4) {
      setState({ visible: false, top: 0, height: 0, track });
      return;
    }
    const thumb = Math.max(48, Math.min(120, track * (view / total)));
    const maxScroll = total - view;
    const maxTop = track - thumb;
    const top = maxScroll > 0 ? (el.scrollTop / maxScroll) * maxTop : 0;
    setState({ visible: true, top, height: thumb, track });
  }, [targetRef, bottomOffset]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [sync, targetRef]);

  if (!state.visible) return null;

  const maxTop = state.track - state.height;

  return (
    <div className="pointer-events-none absolute right-1 top-0 z-20 w-2" style={{ height: state.track }}>
      <div
        className="pointer-events-auto absolute right-0 w-2 cursor-pointer rounded-full bg-foreground/20 transition-colors hover:bg-foreground/35"
        style={{ top: state.top, height: state.height }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startY: event.clientY, startTop: state.top };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const el = targetRef.current;
          if (!el || maxTop <= 0) return;
          const nextTop = Math.min(maxTop, Math.max(0, drag.current.startTop + event.clientY - drag.current.startY));
          el.scrollTop = (nextTop / maxTop) * (el.scrollHeight - el.clientHeight);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
    </div>
  );
}