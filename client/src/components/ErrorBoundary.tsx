/**
 * ErrorBoundary.tsx — Production-grade React error boundary for BIS Platform
 *
 * Features:
 *   - Catches all unhandled React render errors
 *   - Reports errors to the server via /api/trpc (notifyOwner) for owner alerting
 *   - Generates a unique error ID for support reference
 *   - Copy-to-clipboard for the error stack
 *   - Sentry-ready: set VITE_SENTRY_DSN to enable Sentry SDK reporting
 *   - Graceful fallback UI with reload + go-home actions
 */
import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw, Copy, Home, CheckCircle } from "lucide-react";
import { Component, ReactNode } from "react";

// ─── Sentry integration (optional) ───────────────────────────────────────────
// When VITE_SENTRY_DSN is set, errors are reported to Sentry.
// The Sentry SDK is loaded lazily to avoid bundle bloat when not configured.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

async function reportToSentry(error: Error, errorInfo: { componentStack: string }): Promise<void> {
  if (!SENTRY_DSN) return;
  try {
    // Dynamic import so Sentry SDK is only loaded when configured.
    // Use Function constructor to bypass TypeScript module resolution for optional dependency.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('m', 'return import(m)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry = await dynamicImport('@sentry/react') as any;
    Sentry.captureException(error, { extra: errorInfo });
  } catch {
    // Sentry SDK not installed — silently ignore
  }
}

// ─── Server-side error reporting ─────────────────────────────────────────────
async function reportToServer(errorId: string, error: Error, componentStack: string): Promise<void> {
  try {
    await fetch("/api/trpc/system.notifyOwner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        "0": {
          json: {
            title: `[PWA Error] ${errorId}: ${error.name}`,
            content: [
              `**Error ID:** ${errorId}`,
              `**Message:** ${error.message}`,
              `**URL:** ${window.location.href}`,
              `**User Agent:** ${navigator.userAgent}`,
              `**Component Stack:**\n\`\`\`\n${componentStack.slice(0, 1000)}\n\`\`\``,
              `**Stack Trace:**\n\`\`\`\n${error.stack?.slice(0, 1500) ?? 'N/A'}\n\`\`\``,
            ].join('\n\n'),
          },
        },
      }),
    });
  } catch {
    // Server reporting failed — don't cascade
  }
}

// ─── Error ID generator ───────────────────────────────────────────────────────
function generateErrorId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ERR-${ts}-${rand}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
  /** Optional: custom fallback component */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
  errorId: string;
  copied: boolean;
  reported: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      componentStack: "",
      errorId: "",
      copied: false,
      reported: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorId: generateErrorId(),
    };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }): void {
    const { errorId } = this.state;
    this.setState({ componentStack: errorInfo.componentStack });

    // Report to Sentry (if DSN configured)
    reportToSentry(error, errorInfo).catch(() => {});

    // Report to BIS server (owner notification)
    reportToServer(errorId, error, errorInfo.componentStack).then(() => {
      this.setState({ reported: true });
    }).catch(() => {});

    // Also log to console for developer visibility
    console.error(`[ErrorBoundary] ${errorId}:`, error, errorInfo);
  }

  handleCopy = (): void => {
    const { error, componentStack, errorId } = this.state;
    const text = [
      `Error ID: ${errorId}`,
      `URL: ${window.location.href}`,
      `Message: ${error?.message ?? 'Unknown'}`,
      `Stack: ${error?.stack ?? 'N/A'}`,
      `Component Stack: ${componentStack}`,
    ].join('\n\n');

    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {});
  };

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: "",
      errorId: "",
      copied: false,
      reported: false,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, errorId, copied, reported } = this.state;

      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8 rounded-xl border border-border bg-card shadow-lg">
            <AlertTriangle size={48} className="text-destructive mb-4 flex-shrink-0" />

            <h2 className="text-xl font-semibold text-card-foreground mb-1">
              An unexpected error occurred
            </h2>

            <p className="text-sm text-muted-foreground mb-2">
              Error reference:{" "}
              <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{errorId}</code>
            </p>

            {reported && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 mb-4">
                <CheckCircle size={12} />
                <span>Error reported to platform administrators</span>
              </div>
            )}

            <div className="p-4 w-full rounded-lg bg-muted overflow-auto mb-4 max-h-48">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
                {error?.message ?? "Unknown error"}
                {"\n\n"}
                {error?.stack?.split("\n").slice(0, 8).join("\n") ?? ""}
              </pre>
            </div>

            <div className="flex flex-wrap gap-3 justify-center">
              <button
                onClick={this.handleCopy}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "bg-muted text-muted-foreground hover:bg-muted/80",
                  "transition-colors cursor-pointer"
                )}
              >
                {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy Details"}
              </button>

              <button
                onClick={this.handleReset}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  "transition-colors cursor-pointer"
                )}
              >
                <RotateCcw size={14} />
                Try Again
              </button>

              <button
                onClick={() => window.location.reload()}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "bg-primary text-primary-foreground hover:opacity-90",
                  "transition-opacity cursor-pointer"
                )}
              >
                <RotateCcw size={14} />
                Reload Page
              </button>

              <button
                onClick={() => { window.location.href = "/"; }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "bg-muted text-muted-foreground hover:bg-muted/80",
                  "transition-colors cursor-pointer"
                )}
              >
                <Home size={14} />
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
