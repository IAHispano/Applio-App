export interface MenuPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function positionFloatingMenu(
  trigger: HTMLElement,
  minWidth: number,
  minHeight: number,
): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const margin = 8;
  const gap = 4;
  const viewportLeft = (viewport?.offsetLeft ?? 0) + margin;
  const viewportTop = (viewport?.offsetTop ?? 0) + margin;
  const usableWidth = Math.max(0, (viewport?.width ?? window.innerWidth) - margin * 2);
  const usableHeight = Math.max(0, (viewport?.height ?? window.innerHeight) - margin * 2);
  const viewportBottom = viewportTop + usableHeight;
  const width = Math.min(Math.max(rect.width, minWidth), usableWidth);
  const left = Math.min(Math.max(rect.left, viewportLeft), viewportLeft + usableWidth - width);
  const below = Math.max(rect.bottom + gap, viewportTop);
  const above = Math.min(rect.top - gap, viewportBottom);
  const spaceBelow = viewportBottom - below;
  const spaceAbove = above - viewportTop;

  if (spaceBelow >= minHeight) return { left, width, top: below, maxHeight: spaceBelow };
  if (spaceAbove >= minHeight) {
    return { left, width, bottom: window.innerHeight - above, maxHeight: spaceAbove };
  }
  // Keep the options reachable when neither side has enough room.
  return { left, width, top: viewportTop, maxHeight: usableHeight };
}
