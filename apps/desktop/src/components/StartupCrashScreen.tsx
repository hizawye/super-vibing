import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@supervibing/ui";

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
    <Card
      className="startup-crash-card"
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
      <CardHeader style={{ marginBottom: "14px" }}>
        <CardTitle style={{ margin: 0 }}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p style={{ margin: 0, opacity: 0.92 }}>{message}</p>

        <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
        {onRetry ? (
          <Button type="button" variant="primary" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {onResetLocalData ? (
          <Button type="button" variant="subtle" onClick={onResetLocalData}>
            Reset local data
          </Button>
        ) : null}
        {details ? (
          <Button
            type="button"
            variant="subtle"
            onClick={() => setShowDetails((current) => !current)}
            aria-expanded={showDetails}
          >
            {showDetails ? "Hide details" : "Show details"}
          </Button>
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
      </CardContent>
    </Card>
  );
}
