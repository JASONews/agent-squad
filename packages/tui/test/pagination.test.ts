import { describe, expect, it } from 'vitest';
import { clampSelection, getPageWindow, selectedIndexById } from '../src/pagination.js';
import { readTerminalSize } from '../src/useTerminalSize.js';

describe('getPageWindow', () => {
  it('clamps page requests and keeps a partial final page visible', () => {
    expect(getPageWindow(25, 10, 99)).toEqual({
      page: 2,
      pageCount: 3,
      start: 20,
      end: 25,
    });
    expect(getPageWindow(25, 10, -3)).toEqual({
      page: 0,
      pageCount: 3,
      start: 0,
      end: 10,
    });
  });

  it('returns a stable empty page for empty collections', () => {
    expect(getPageWindow(0, 0, 10)).toEqual({
      page: 0,
      pageCount: 1,
      start: 0,
      end: 0,
    });
  });
});

describe('clampSelection', () => {
  it('never returns a negative selection for empty or shrinking lists', () => {
    expect(clampSelection(0, -1)).toBe(0);
    expect(clampSelection(1, -1)).toBe(0);
    expect(clampSelection(2, 9)).toBe(1);
  });
});

describe('selectedIndexById', () => {
  it('preserves the selected item when live updates reorder the collection', () => {
    expect(selectedIndexById(['latest', 'selected'], 'selected')).toBe(1);
    expect(selectedIndexById(['selected', 'latest'], 'selected')).toBe(0);
    expect(selectedIndexById(['fallback'], 'removed')).toBe(0);
  });
});

describe('readTerminalSize', () => {
  it('uses fallbacks and enforces a usable minimum viewport', () => {
    expect(readTerminalSize({ columns: undefined, rows: undefined } as Pick<NodeJS.WriteStream, 'columns' | 'rows'>))
      .toEqual({ columns: 80, rows: 24 });
    expect(readTerminalSize({ columns: 5, rows: 1 } as Pick<NodeJS.WriteStream, 'columns' | 'rows'>))
      .toEqual({ columns: 5, rows: 1 });
  });
});
