export interface PageWindow {
  page: number;
  pageCount: number;
  start: number;
  end: number;
}

export function clampSelection(totalItems: number, requestedIndex: number): number {
  const maxIndex = Math.max(0, Math.floor(totalItems) - 1);
  const safeIndex = Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0;
  return Math.min(maxIndex, Math.max(0, safeIndex));
}

export function selectedIndexById(ids: string[], selectedId: string | null): number {
  if (selectedId === null) return 0;
  const index = ids.indexOf(selectedId);
  return index >= 0 ? index : 0;
}

export function getPageWindow(totalItems: number, pageSize: number, requestedPage: number): PageWindow {
  const safeTotal = Math.max(0, Math.floor(totalItems));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const page = Math.min(pageCount - 1, Math.max(0, Math.floor(requestedPage)));
  const start = page * safePageSize;
  return {
    page,
    pageCount,
    start,
    end: Math.min(safeTotal, start + safePageSize),
  };
}
