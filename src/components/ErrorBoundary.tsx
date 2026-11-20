import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'An unexpected error occurred.';
    try {
      const parsed = JSON.parse(readable);
      if (parsed?.error) {
        readable = `${parsed.operationType?.toUpperCase() || 'Operation'} failed: ${parsed.error}`;
      }
    } catch {
      // Keep plain error message
    }
    return { hasError: true, message: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#141413] text-[#edece8] flex items-center justify-center p-6 font-['Inter']">
          <div className="max-w-md w-full bg-[#1f1f1e] border border-[#2f2f2c] rounded-2xl p-6 space-y-4">
            <h1 className="text-lg font-medium text-white lowercase">closer</h1>
            <p className="text-xs text-[#9c9a92] leading-relaxed">{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-white hover:bg-[#e0dfd9] text-black text-xs font-medium transition-colors"
            >
              Reload workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
