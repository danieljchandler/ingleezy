import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logClientError } from "@/lib/errorLog";

type Props = {
  children: React.ReactNode;
  name?: string;
};

type State = {
  error: Error | null;
  errorType: "network" | "auth" | "unknown";
  showDetails: boolean;
};

const NETWORK_PATTERNS = [
  /\bfetch\b/,
  /\bnetwork\b/,
  /failed to load/,
  /\btimeout\b/,
  /timed out/,
];

/**
 * Deliberately narrower than "mentions a token".
 *
 * "Unexpected token < in JSON at position 0" is what every browser throws when a
 * request that expected JSON got an HTML error page instead — one of the
 * commonest render-time errors there is, and nothing to do with the session.
 * Matching a bare `token` substring classified it as an expired session and sent
 * the user to /auth, where signing in again fixed nothing. So a token only
 * counts when something says which kind of token it is, or what went wrong with
 * it.
 */
const AUTH_PATTERNS = [
  /\bauth\b/,
  /\bjwt\b/,
  /\bunauthorized\b/,
  /\b401\b/,
  /\b(access|refresh|id|bearer|session)[ _-]token\b/,
  /\btoken (has )?expired\b/,
  /\b(invalid|missing|malformed) token\b/,
];

function classifyError(error: Error): "network" | "auth" | "unknown" {
  const msg = error.message?.toLowerCase() || "";
  if (NETWORK_PATTERNS.some((re) => re.test(msg))) return "network";
  if (AUTH_PATTERNS.some((re) => re.test(msg))) return "auth";
  return "unknown";
}

// Arabic, like the rest of the chrome. A learner meeting an error screen is
// already having a bad time; making them read it in the language they came
// here to learn is the wrong moment to insist. The raw error text below stays
// in English on purpose — that one is a fact for whoever gets the screenshot,
// not a message for the learner.
const ERROR_MESSAGES: Record<string, { title: string; description: string; action: string }> = {
  network: {
    title: "ما قدرنا نوصل",
    description: "ما وصلنا للخادم. تأكد من الإنترنت وجرّب مرة ثانية.",
    action: "جرّب مرة ثانية",
  },
  auth: {
    title: "انتهت الجلسة",
    description: "سجّل دخولك مرة ثانية عشان تكمّل.",
    action: "سجّل الدخول",
  },
  unknown: {
    title: "صار خطأ",
    description: "الصفحة واجهت خطأ وهي تحمّل. سجّلنا التفاصيل عندنا.",
    action: "جرّب مرة ثانية",
  },
};

/**
 * Catches render-time React errors and shows a friendly fallback instead of a white screen.
 * Provides specific error messages and recovery actions based on error type.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorType: "unknown", showDetails: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorType: classifyError(error), showDetails: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error", {
      name: this.props.name,
      error,
      errorInfo,
    });
    void logClientError({
      message: error.message || String(error),
      stack: error.stack ?? null,
      meta: { boundary: this.props.name, componentStack: errorInfo.componentStack },
    });
  }

  handleRetry = () => {
    if (this.state.errorType === "auth") {
      window.location.href = "/auth";
    } else {
      this.setState({ error: null, errorType: "unknown", showDetails: false });
    }
  };

  toggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render() {
    if (!this.state.error) return this.props.children;

    const messages = ERROR_MESSAGES[this.state.errorType];

    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>{messages.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {messages.description}
              </p>
              {/*
                On every panel, not just the generic one. The friendly sentence
                is right for the learner; the person they forward the screenshot
                to needs a fact. Gating this on `unknown` meant a misclassified
                error — see classifyError above — left a screen containing
                nothing about what actually failed.
              */}
              <div>
                <button
                  type="button"
                  onClick={this.toggleDetails}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  {this.state.showDetails ? "أخفِ التفاصيل" : "ورّني التفاصيل"}
                </button>
                {this.state.showDetails && (
                  <pre className="mt-2 text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                    {String(this.state.error?.message ?? this.state.error)}
                  </pre>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={this.handleRetry}>
                  {messages.action}
                </Button>
                {this.state.errorType !== "auth" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => window.location.reload()}
                  >
                    أعد تحميل الصفحة
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}

