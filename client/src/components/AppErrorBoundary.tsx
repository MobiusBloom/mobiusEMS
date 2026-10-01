import { Component, type ErrorInfo, type ReactNode } from "react";

const reloadKey = "mobius-chunk-reload";

export const forceHardReload = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("_v", String(Date.now()));
  window.location.replace(url.toString());
};

export const recoverStaleChunk = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!/dynamically imported module|loading chunk|chunkloaderror|importing a module script|failed to fetch|load failed/i.test(message)) {
    return false;
  }
  try {
    const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
    if (Date.now() - lastReload < 15_000) return false;
    sessionStorage.setItem(reloadKey, String(Date.now()));
  } catch {
    // Storage can be disabled. Keep the recovery button available without a reload loop.
    return false;
  }
  forceHardReload();
  return true;
};

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Application render failed", error, info.componentStack);
    recoverStaleChunk(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-soft">
          <h1 className="text-2xl font-semibold text-slate-900">This page could not load</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            The application has been updated with the latest changes. Reload to load the newest version.
          </p>
          <button
            type="button"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-700 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-brand-800 cursor-pointer"
            onClick={forceHardReload}
          >
            Reload page
          </button>
        </div>
      </main>
    );
  }
}

