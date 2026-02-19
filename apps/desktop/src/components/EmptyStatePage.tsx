import { Button } from "@supervibing/ui";

interface EmptyStatePageProps {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyStatePage({ title, subtitle, actionLabel, onAction }: EmptyStatePageProps) {
  return (
    <section className="section-surface section-surface--headed">
      <header className="section-head">
        <h2>{title}</h2>
      </header>

      <div className="empty-state-wrap">
        <div className="empty-icon" aria-hidden="true">
          ◇
        </div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
        {actionLabel && onAction ? (
          <Button type="button" variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
