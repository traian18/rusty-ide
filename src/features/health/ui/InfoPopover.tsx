import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import s from "./Health.module.css";

/** A small button that opens a balloon with an explanation; a click outside or Escape closes it. */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={box} className={s.info}>
      <button type="button" className={s.infoButton} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Info size={13} aria-hidden /> {label}
      </button>
      {open ? (
        <span id={id} role="dialog" aria-label={label} className={s.infoBalloon}>
          {children}
        </span>
      ) : null}
    </span>
  );
}
