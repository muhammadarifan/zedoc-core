/** Renders a ZeDocument to a complete, self-contained guest-facing HTML page (`<!DOCTYPE html>…`). */
export interface RenderOptions {
  /** Which artboard role to render. Default `'invitation'`. */
  artboardRole?: string
  /** Language presets keyed by `data.language` (be-invitation's `window.INVITATION_LABELS`). Default: that global, when the page has it. */
  labels?: Record<string, { fields?: Record<string, string>; textReplacements?: Record<string, string>; script?: Record<string, string> }>
  /** Start with the opening gate already open (a preview). `data.skipOpeningOverlay` does the same. */
  skipOpeningOverlay?: boolean
}

export function render(doc: unknown, data?: unknown, opts?: RenderOptions): string

declare const engine: { render: typeof render }
export default engine
