/// <reference types="vite/client" />

// React 18 doesn't include `inert` in HTMLAttributes; add it globally so TSX can use it
declare namespace React {
  interface HTMLAttributes<T> {
    inert?: '' | undefined
  }
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_RAZORPAY_KEY_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
