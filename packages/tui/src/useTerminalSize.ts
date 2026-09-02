import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
  columns: number;
  rows: number;
}

export function readTerminalSize(
  stdout: Pick<NodeJS.WriteStream, 'columns' | 'rows'>,
  fallback: TerminalSize = { columns: 80, rows: 24 },
): TerminalSize {
  return {
    columns: Math.max(1, stdout.columns ?? fallback.columns),
    rows: Math.max(1, stdout.rows ?? fallback.rows),
  };
}

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => readTerminalSize(stdout));

  useEffect(() => {
    const update = () => setSize(readTerminalSize(stdout));
    update();
    stdout.on('resize', update);
    return () => {
      stdout.off('resize', update);
    };
  }, [stdout]);

  return size;
}
