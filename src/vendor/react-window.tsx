import type { CSSProperties, ReactNode } from "react";

export interface ListChildComponentProps<T = unknown> {
  index: number;
  style: CSSProperties;
  data: T;
}

export interface FixedSizeListProps<T = unknown> {
  height: number;
  itemCount: number;
  itemSize: number;
  width?: number | string;
  itemData?: T;
  children: (props: ListChildComponentProps<T>) => ReactNode;
}

export function FixedSizeList<T = unknown>({ height, itemCount, itemSize, width = "100%", itemData, children }: FixedSizeListProps<T>) {
  const visibleCount = Math.min(itemCount, Math.ceil(height / itemSize) + 8);
  return (
    <div style={{ height, width, overflow: "auto", position: "relative" }}>
      <div style={{ height: itemCount * itemSize, position: "relative" }}>
        {Array.from({ length: visibleCount }, (_, index) => (
          <div key={index} style={{ position: "absolute", left: 0, right: 0, top: index * itemSize, height: itemSize }}>
            {children({ index, style: { height: itemSize }, data: itemData as T })}
          </div>
        ))}
      </div>
    </div>
  );
}
