import { useState } from "react";

interface StartupCrashScreenProps {
  title: string;
  message: string;
  details?: string;
  onRetry?: () => void;
  onResetLocalData?: () => void;
}

export function StartupCrashScreen({
  title,
  message,
  details,
  onRetry,
  onResetLocalData,
}: StartupCrashScreenProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <section
      style={{
        width: "min(760px, calc(100vw - 32px))",
        background: "#101826",
        color: "#edf3ff",
        border: "1px solid #2f425f",
        borderRadius: "16px",
        padding: "20px",
        boxShadow: "0 16px 44px rgba(0, 0, 0, 0.45)",
      }}
    >
      <header style={{ marginBottom: "14px" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
      </header>
      <p style={{ margin: 0, opacity: 0.92 }}>{message}</p>

      <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
        {onRetry ? (
          <button type="button" className="primary-btn" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {onResetLocalData ? (
          <button type="button" className="subtle-btn" onClick={onResetLocalData}>
            Reset local data
          </button>
        ) : null}
        {details ? (
          <button
            type="button"
            className="subtle-btn"
            onClick={() => setShowDetails((current) => !current)}
            aria-expanded={showDetails}
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
        ) : null}
      </div>

      {showDetails && details ? (
        <pre
          style={{
            marginTop: "14px",
            marginBottom: 0,
            padding: "12px",
            borderRadius: "10px",
            background: "#0a111d",
            color: "#d7e2ff",
            border: "1px solid #28405e",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "220px",
            overflow: "auto",
          }}
        >
          {details}
        </pre>
      ) : null}
    </section>
  );
}
