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
  /** Column of the box (for the flow); absent = spans every column. */
  left?: number
  width?: number
  /** Outputs: final top/height, how far it moved, and how much it grew. */
  y?: number
  shift?: number
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
  /** Rewrites an asset/image url on its way out (the designer prefixes its origin). */
  mapSrc?: (src: string) => string
  /** 'gallery' marks a photo for the guest page's lightbox. */
  repeatListKey?: string
  /** 'edit' = the designer canvas (content-height text, placeholders, no guest hooks); default is the guest page. */
  mode?: 'edit' | 'guest'
  /** Where the text flow put a node instance, by path (canvas). */
  place?: (path: string) => { y: number; h: number } | undefined
  /** Guest-only behaviour layered on a node's view; return a view to replace it. */
  decorate?: (node: any, view: ViewNode, ctx: any, o: { path: string; frame: any }) => ViewNode | void
  fontStyleOverride?: Record<string, { size?: number; weight?: number; italic?: boolean; underline?: boolean } | undefined>
}

/** A neutral view tree: hosts serialise it (toHtml) or map it to their own elements. */
export interface ViewNode {
  tag?: string
  /** Insertion order is the serialised attribute order; `true` writes a bare attribute. */
  attrs?: Record<string, string | true>
  style?: StyleObject
  children?: (ViewNode | string)[]
  /** Raw markup for the element's content (imported SVG). */
  html?: string
  /** Edit mode: the key the host reports this text's rendered height under. */
  measure?: string
  /** No wrapper of its own - just these children (a repeat's items). */
  fragment?: ViewNode[]
  /** Trusted markup standing in for the whole view (guest-only pieces). */
  raw?: string
  /** Something only the host can draw (a block, an icon): it gets the node and its context back. */
  ext?: 'block'
  node?: unknown
  ctx?: unknown
}

export interface GuestRole {
  name: string
  /** The node type the role applies to ('*' = any). */
  type: string
  role: string
  /** Which one of a pair (yes/no, the countdown unit, the input). */
  arg?: string
  /** A template may legitimately use the name for something else; validators do not police it. */
  optional?: boolean
}

declare const core: {
  /** The names the guest page recognises to make hand-drawn elements live. */
  GUEST_ROLES: GuestRole[]
  guestRole(node: { name?: string; type: string }): GuestRole | null
  isStretchShape(node: { name?: string; type: string }): boolean
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
  /** `autoHeight` keeps the box at its content height (the canvas measures it) instead of filling the frame. */
  textView(
    node: {
      name?: string
      text: string
      binding?: { key: string } | null
      style: {
        font: { kind: string; token?: string; family?: string }
        size: number
        weight: number
        lineHeight: number
        letterSpacing: number
        align: string
        color: { kind: string; token?: string; value?: string }
        italic: boolean
        underline: boolean
        transform: string
      }
    },
    ctx: ResolveContext,
    opts?: { autoHeight?: boolean; measure?: string },
  ): ViewNode
  imageView(
    node: { binding?: { key: string } | null; assetId: string | null; radius: number; alt: string; fit: string },
    ctx: ResolveContext,
  ): ViewNode
  shapeView(
    node: {
      shape: string
      radius: number
      fill: { kind: string }
      stroke: { width: number; style: string; color: { kind: string; token?: string; value?: string } }
    },
    ctx: ResolveContext,
  ): ViewNode
  svgView(node: { markup: string }): ViewNode
  /** The icon catalogue as lucide path data: name -> [tag, attrs][]. */
  ICONS: Record<string, [string, Record<string, string>][]>
  /** An icon's svg view, or null for a name outside the catalogue. */
  iconSvg(name: string, color: string, strokeWidth: number, style?: StyleObject): ViewNode | null
  iconView(node: { icon: string; strokeWidth: number; color: { kind: string; token?: string; value?: string } }, ctx: ResolveContext): ViewNode | null
  toHtml(view: ViewNode | string, ext?: (view: ViewNode) => string): string
  nodeView(node: any, ctx: ResolveContext, o?: { path?: string; y?: number | null; heightGrow?: number }): ViewNode | null
  contentViews(node: any, ctx: ResolveContext, path: string): ViewNode[]
  childViews(nodes: any[], ctx: ResolveContext, path: string): ViewNode[]
  repeatItemViews(
    node: any,
    ctx: ResolveContext,
    path: string,
    o: { frame: { x: number; y: number; w: number; h: number }; origin: { x: number; y: number }; opacity: number },
  ): ViewNode[]
  groupCtx<C extends ResolveContext>(node: any, ctx: C): C
  childPath(parent: string, id: string): string
  itemPath(repeat: string, index: number): string
  COUPLE_FIELD_REMAP: Record<string, string>
  eventUnboundTextKey(unboundIndex: number): string | null
  styleText(style: StyleObject): string
  escapeHtml(value: unknown): string

  repeatGridPlacements(
    origin: { x: number; y: number },
    itemW: number,
    itemH: number,
    columns: number,
    gap: number,
    count: number,
  ): GridLayout
  flowBoxes(boxes: FlowBox[]): { shift: number; bottom: number }
  /** CSS for a node's `animations` on a guest page, or null when it has none. `reveal` = some entry waits for the node to scroll into view. */
  motionStyle(node: { animations?: MotionAnimation[]; animationPlayMode?: 'parallel' | 'sequence' }): { style: Record<string, string>; presets: string[]; reveal: boolean } | null
  /** `@keyframes` text per preset, named `zd-motion-<preset>`. */
  MOTION_KEYFRAMES: Record<string, string>
  reflowNodes<T extends ReflowNodeLike>(nodes: (T | RepeatNodeLike)[], data: Record<string, unknown>): ReflowResult<T | RepeatNodeLike>
}

export interface MotionAnimation {
  preset: string
  trigger: 'load' | 'reveal' | 'loop'
  duration: number
  delay: number
  easing: string
  amount?: number
  overshoot?: number
  direction?: 'cw' | 'ccw'
}

export default core
