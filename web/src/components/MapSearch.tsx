import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FlowGrower, NetDestination } from "../api";
import { Highlight } from "./DestinationPicker";

export interface Place {
  id: string;
  type: "destination" | "grower";
  name: string;
  /** Town and county or country, shown under the name. */
  where: string;
  /** Filter group: "destination", "grower", "seed_supplier", "tool_maker", "farmer_group". */
  group: string;
  color: string;
  lat: number;
  lng: number;
  /** Lower-cased text the query is matched against. */
  text: string;
}

const GROUP_LABEL: Record<string, string> = {
  destination: "Destinations",
  grower: "Growers",
  seed_supplier: "Seed",
  tool_maker: "Tools",
  farmer_group: "Farmer groups",
};
const GROUP_ORDER = Object.keys(GROUP_LABEL);

export function placesFrom(
  growers: FlowGrower[],
  destinations: NetDestination[],
  colors: { need: Record<number, string>; kind: Record<string, string>; kindLabel: Record<string, string> },
): Place[] {
  return [
    ...destinations.map((d) => ({
      id: d.id,
      type: "destination" as const,
      name: d.name,
      where: `${d.county} · need phase ${d.need_phase} · ${(d.people_in_need / 1000).toFixed(0)}k people`,
      group: "destination",
      color: colors.need[d.need_phase] ?? colors.need[3],
      lat: d.lat,
      lng: d.lng,
      text: `${d.name} ${d.county} kenya`.toLowerCase(),
    })),
    ...growers.map((g) => ({
      id: g.id,
      type: "grower" as const,
      name: g.name,
      where: `${colors.kindLabel[g.kind] ?? g.kind} · ${g.town}, ${!g.country || g.country === "Kenya" ? g.county : g.country}`,
      group: g.kind === "farm" || g.kind === "coop" ? "grower" : g.kind,
      color: colors.kind[g.kind] ?? colors.kind.coop,
      lat: g.lat,
      lng: g.lng,
      text: `${g.name} ${g.town} ${g.county} ${g.country ?? "kenya"}`.toLowerCase(),
    })),
  ];
}

/**
 * Search box over the map: type a town, county, grower or country, narrow by type, then pick a
 * result to fly there. Keyboard: ↑/↓ to move, Enter to choose, Esc to close.
 */
export default function MapSearch({
  places,
  onPick,
  onClear,
}: {
  places: Place[];
  /** The map flies to the picked place. */
  onPick: (p: Place) => void;
  onClear: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Focus selects the text so typing replaces it; the click's mouseup would otherwise undo that.
  const justFocused = useRef(false);

  const groups = GROUP_ORDER.filter((g) => places.some((p) => p.group === g));
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    return places
      .filter((p) => (group === "all" || p.group === group) && words.every((w) => p.text.includes(w)))
      .sort((a, b) => {
        // Names that start with the query first, then destinations, then A to Z.
        const sa = q && a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = q && b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || (a.type === b.type ? 0 : a.type === "destination" ? -1 : 1) || a.name.localeCompare(b.name);
      });
  }, [places, q, group]);

  useEffect(() => setActive(0), [q, group]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Close when clicking anywhere outside the box.
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);

  function choose(p: Place) {
    onPick(p);
    setQuery(p.name);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="mapsearch" ref={boxRef}>
      <div className="combo-input">
        <span className="combo-icon" aria-hidden>⌕</span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Find a place on the map"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined}
          placeholder="Find a town, county, grower or country"
          value={query}
          onMouseUp={(e) => {
            if (justFocused.current) e.preventDefault();
            justFocused.current = false;
          }}
          onFocus={(e) => {
            justFocused.current = true;
            e.target.select();
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
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
              inputRef.current?.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="mapsearch-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              onClear();
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="mapsearch-panel">
          <div className="mapsearch-filters" role="group" aria-label="Show only">
            {["all", ...groups].map((g) => (
              <button
                key={g}
                type="button"
                className={group === g ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setGroup(g)}
              >
                {g === "all" ? "All" : GROUP_LABEL[g]}
                <span className="n">{g === "all" ? places.length : places.filter((p) => p.group === g).length}</span>
              </button>
            ))}
          </div>
          <ul ref={listRef} id={`${id}-list`} role="listbox" className="mapsearch-list">
            {matches.length === 0 ? (
              <li className="combo-empty">No place on the map matches “{query.trim()}”{group !== "all" ? ` in ${GROUP_LABEL[group].toLowerCase()}` : ""}.</li>
            ) : (
              matches.map((p, i) => (
                <li
                  key={`${p.type}-${p.id}`}
                  id={`${id}-${p.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                >
                  <span className={`combo-dot ${p.type === "destination" ? "dest" : ""}`} style={{ background: p.color }} />
                  <span className="combo-main">
                    <span className="combo-name">
                      <Highlight text={p.name} q={query.trim()} />
                    </span>
                    <span className="muted small">
                      <Highlight text={p.where} q={query.trim()} />
                    </span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
