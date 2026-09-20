/** Renders a ZeDocument to a complete, self-contained guest-facing HTML page (`<!DOCTYPE html>…`). */
export interface RenderOptions {
  /** Which artboard role to render. Default `'invitation'`. */
  artboardRole?: string
}

export function render(doc: unknown, data?: unknown, opts?: RenderOptions): string

declare const engine: { render: typeof render }
export default engine
