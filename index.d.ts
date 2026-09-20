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

declare const core: {
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
