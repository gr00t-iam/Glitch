import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string[];
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) =>
      [command.label, command.group, command.hint, ...(command.keywords ?? [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const grouped = filtered.reduce<Record<string, PaletteCommand[]>>((accumulator, command) => {
    (accumulator[command.group] ??= []).push(command);
    return accumulator;
  }, {});

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) {
        onClose();
        command.run();
      }
    }
  }

  let runningIndex = -1;

  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div className="palette" onClick={(event) => event.stopPropagation()} onKeyDown={handleKeyDown} role="dialog" aria-label="Command palette">
        <div className="palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            aria-label="Search commands"
            placeholder="Type a command or search..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matching commands.</div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div className="palette-group" key={group}>
                <div className="palette-group-label">{group}</div>
                {items.map((command) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  return (
                    <button
                      key={command.id}
                      className={`palette-item ${index === activeIndex ? "active" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        onClose();
                        command.run();
                      }}
                    >
                      <span>{command.label}</span>
                      {command.hint && <small>{command.hint}</small>}
                      {index === activeIndex && <CornerDownLeft size={14} />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
