import type { AppSection } from "../types";

interface SectionMenuProps {
  open: boolean;
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  onClose: () => void;
}

const SECTION_ITEMS: Array<{ id: AppSection; label: string; hint?: string }> = [
  { id: "terminal", label: "Terminal" },
  { id: "kanban", label: "Kanban Board", hint: "PRO" },
  { id: "agents", label: "Agents", hint: "PRO" },
  { id: "prompts", label: "Prompts", hint: "PRO" },
  { id: "settings", label: "Settings" },
];

export function SectionMenu({ open, activeSection, onSelectSection, onClose }: SectionMenuProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="section-menu-overlay" role="presentation" onClick={onClose}>
      <div className="section-menu" role="dialog" aria-label="Navigate" onClick={(event) => event.stopPropagation()}>
        <h3>Navigate</h3>
        <div className="section-menu-list">
          {SECTION_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`section-menu-item ${item.id === activeSection ? "active" : ""}`}
              onClick={() => {
                onSelectSection(item.id);
                onClose();
              }}
            >
              <span>{item.label}</span>
              {item.hint ? <small>{item.hint}</small> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
