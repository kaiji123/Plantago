import { useEffect, useId, useMemo, useRef, useState } from "react";
import { num, type Destination } from "../api";

const PHASE_LABEL: Record<number, string> = { 3: "Crisis", 4: "Emergency", 5: "Famine" };
const PHASE_COLOR: Record<number, string> = { 3: "#e9a23b", 4: "#d1492e", 5: "#8c1c13" };

/** Bold the part of `text` that matches `q`. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * Type-to-search destination picker (ARIA combobox). Matches town or county,
 * keyboard: ↑/↓ to move, Enter to choose, Esc to close.
 */
export default function DestinationPicker({
  destinations,
  value,
  onChange,
}: {
  destinations: Destination[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const selected = destinations.find((d) => d.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = selected && !open ? `${selected.name}, ${selected.county}` : query;
  const q = query.trim();
  const matches = useMemo(() => {
    const qq = q.toLowerCase();
    return destinations
      .filter((d) => !qq || d.name.toLowerCase().includes(qq) || d.county.toLowerCase().includes(qq))
      .sort((a, b) => {
        // Names that start with the query first, then by need.
        const sa = a.name.toLowerCase().startsWith(qq) ? 0 : 1;
        const sb = b.name.toLowerCase().startsWith(qq) ? 0 : 1;
        return sa - sb || b.need_phase - a.need_phase || b.people_in_need - a.people_in_need;
      });
  }, [destinations, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(d: Destination) {
    onChange(d.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="combo">
      <div className="combo-input">
        <span className="combo-icon" aria-hidden>⌕</span>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined}
          placeholder="Type a town or county, e.g. Turkana"
          value={shown}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && matches[active]) choose(matches[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
              inputRef.current?.blur();
            }
          }}
        />
        {selected && !open && (
          <span className="combo-phase" style={{ background: PHASE_COLOR[selected.need_phase] }}>
            Phase {selected.need_phase}
          </span>
        )}
      </div>
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" className="combo-list">
          {matches.length === 0 ? (
            <li className="combo-empty">
              No destination matches “{q}”. Plantago currently serves {destinations.length} places in northern Kenya.
            </li>
          ) : (
            matches.map((d, i) => (
              <li
                key={d.id}
                id={`${id}-${d.id}`}
                data-i={i}
                role="option"
                aria-selected={d.id === value}
                className={`${i === active ? "active" : ""} ${d.id === value ? "current" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(d)}
              >
                <span className="combo-dot" style={{ background: PHASE_COLOR[d.need_phase] }} />
                <span className="combo-main">
                  <span className="combo-name">
                    <Highlight text={d.name} q={q} />
                    <span className="muted">, <Highlight text={d.county} q={q} /></span>
                  </span>
                  <span className="muted small">
                    {PHASE_LABEL[d.need_phase] ?? `Phase ${d.need_phase}`} · {num(d.people_in_need)} people in need · {d.climate.replace("_", "-")}
                  </span>
                </span>
                {d.id === value && <span className="combo-check" aria-hidden>✓</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
