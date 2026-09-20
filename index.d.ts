export interface GridPlacement {
  x: number
  y: number
  scale: number
}

export interface GridLayout {
  placements: GridPlacement[]
  totalHeight: number
}

export interface ReflowItem<T> {
  node: T
  y: number
}

export interface ReflowResult<T> {
  items: ReflowItem<T>[]
  extra: number
  bgHeightGrow: Record<number, number>
}

export interface FlowBox {
  top: number
  height: number
  /** A text leaf's real rendered height; the box grows to it, never shrinks. */
  textHeight?: number
  /** A partial background: grows with siblings that start inside its span. */
  stretch?: boolean
  /** Makes the box a container that grows with its children's flow. */
  children?: FlowBox[]
  /** Outputs: final top/height, and this box's own contribution to the shift. */
  y?: number
  h?: number
  grow?: number
}

interface RepeatNodeLike {
  type: 'repeat'
  listKey: string
  frame: { x: number; y: number; w: number; h: number }
  verifiedCount?: number
  columns?: number
  gap?: number
}

interface ReflowNodeLike {
  type: string
  name?: string
  frame: { x: number; y: number; w: number; h: number }
}

export type FieldKind = 'text' | 'image' | 'link' | 'audio' | 'datetime'

export interface FieldDef {
  key: string
  /** Indonesian label - the vocabulary is Indonesian, same as the source data. */
  label: string
  kind: FieldKind
  group: string
  /** Stand-in value shown on the canvas while designing. */
  sample: string
}

export interface ListDef {
  key: string
  label: string
  itemKeys: string[]
  /** `couple` is the one list the organiser cannot grow - always exactly two. */
  fixedCount?: number
}

/** CSS-in-JS: camelCase keys, lengths already carry their unit ('12px'). */
export type StyleObject = Record<string, string | number | undefined>

/** The structural minimum the resolve layer reads; the designer's Zod types satisfy it. */
export interface ResolveContext {
  theme: { palette: Record<string, string>; fonts: Record<string, string> }
  data: {
    fields?: Record<string, string>
    links?: Record<string, string>
    audio?: Record<string, string>
    images?: Record<string, string>
  }
  assets: { id: string; src: string }[]
  repeatItem?: Record<string, unknown> | null
  preferLiteralText?: boolean
  fontStyleOverride?: Record<string, { size?: number; weight?: number; italic?: boolean; underline?: boolean } | undefined>
}

declare const core: {
  FIELDS: FieldDef[]
  LISTS: ListDef[]
  findField(key: string): FieldDef | undefined
  isKnownField(key: string): boolean
  resolveColor(ref: { kind: string; token?: string; value?: string }, theme: ResolveContext['theme']): string
  resolveFont(ref: { kind: string; token?: string; family?: string }, theme: ResolveContext['theme']): string
  mergeTheme<T extends ResolveContext['theme']>(theme: T, style: { palette?: object; fonts?: object } | undefined): T
  mergeFontStyleOverride<T>(existing: T | undefined, incoming: { display?: object; body?: object } | undefined): T | undefined
  resolveTextStyle(
    node: { style: { font: { kind: string; token?: string }; size: number; weight: number; italic: boolean; underline: boolean } },
    ctx: Pick<ResolveContext, 'fontStyleOverride'>,
  ): { size: number; weight: number; italic: boolean; underline: boolean }
  findAsset<A extends { id: string }>(assets: A[], assetId: string | null): A | null
  /** `mapSrc` rewrites an asset/image url on its way out (the designer prefixes its origin). */
  resolveFill(fill: { kind: string }, ctx: ResolveContext, mapSrc?: (src: string) => string): StyleObject
  resolveText(node: { name?: string; text: string; binding?: { key: string } | null }, ctx: ResolveContext): string
  bucketFor(key: string, data: ResolveContext['data']): Record<string, string>
  resolveImageSrc(
    node: { binding?: { key: string } | null; assetId: string | null },
    ctx: ResolveContext,
    mapSrc?: (src: string) => string,
  ): string | null
  frameStyle(frame: { x: number; y: number; w: number; h: number; rotate?: number; flipX?: boolean; flipY?: boolean }, opacity: number): StyleObject
  clipStyleFor(clip: { shape: string; radius?: number; polygon?: string }): StyleObject

  repeatGridPlacements(
    origin: { x: number; y: number },
    itemW: number,
    itemH: number,
    columns: number,
    gap: number,
    count: number,
  ): GridLayout
  flowBoxes(boxes: FlowBox[]): { shift: number; bottom: number }
  reflowNodes<T extends ReflowNodeLike>(nodes: (T | RepeatNodeLike)[], data: Record<string, unknown>): ReflowResult<T | RepeatNodeLike>
}

export default core
