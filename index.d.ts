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
  reflowNodes<T extends ReflowNodeLike>(nodes: (T | RepeatNodeLike)[], data: Record<string, unknown>): ReflowResult<T | RepeatNodeLike>
}

export default core
