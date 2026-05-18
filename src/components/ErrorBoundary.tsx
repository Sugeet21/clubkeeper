import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ClubKeeper] Unhandled error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-busy/20 border border-busy/30 flex items-center justify-center text-2xl">
            ⚠
          </div>
          <div>
            <h2 className="text-[18px] font-bold text-text mb-1">Something went wrong.</h2>
            {this.state.message && (
              <p className="text-[12px] font-mono text-text-faint">{this.state.message}</p>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-accent text-bg px-8 py-3.5 rounded-2xl text-[15px] font-bold"
          >
            Tap to reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
