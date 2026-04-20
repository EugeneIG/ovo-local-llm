import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "../i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    // [START] i18n — ErrorBoundary is a class component and can't use the
    // useTranslation hook, so we reach into the global i18n instance directly.
    const t = i18n.t.bind(i18n);
    // [END]

    return (
      <div className="h-screen overflow-auto bg-ovo-bg text-ovo-text p-8 font-mono text-sm">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl font-bold text-rose-700 mb-2">{t("error_boundary.title")}</h1>
          <p className="text-ovo-muted mb-4">
            {t("error_boundary.body")}
          </p>
          <pre className="p-4 bg-ovo-surface border border-ovo-border rounded-lg whitespace-pre-wrap break-words mb-3">
            {error.name}: {error.message}
            {"\n\n"}
            {error.stack ?? ""}
          </pre>
          {info?.componentStack && (
            <pre className="p-4 bg-ovo-surface border border-ovo-border rounded-lg whitespace-pre-wrap break-words text-[11px] text-ovo-muted">
              {info.componentStack}
            </pre>
          )}
          <button
            onClick={this.reset}
            className="mt-4 px-4 py-2 rounded-md bg-ovo-accent text-ovo-accent-ink text-xs hover:bg-ovo-accent-hover transition"
          >
            {t("error_boundary.retry")}
          </button>
        </div>
      </div>
    );
  }
}
