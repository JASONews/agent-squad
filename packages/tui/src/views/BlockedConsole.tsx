import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';

export function BlockedConsole({ state, sessionId, onBack }: {
  state: TuiState; sessionId: string; onBack: () => void;
}) {
  const blocked = state.subagents[sessionId]?.filter((s) => s.blocked) ?? [];
  useInput((input) => {
    if (input === 'q') onBack();
  });
  return (
    <Box flexDirection="column">
      <Text bold>Native Blocked Console — {sessionId.slice(0, 12)}</Text>
      {blocked.length === 0 && <Text dimColor>No blocked subagents.</Text>}
      {blocked.map((s) => (
        <Box key={s.id} flexDirection="column">
          <Text color="red">{'  '}{s.alias} ({s.cliType}) — BLOCKED</Text>
          {s.rawTail && (
            <Box marginLeft={4} flexDirection="column">
              <Text dimColor>raw_tail:</Text>
              {formatTailLines(s.rawTail).map((line, idx) => (
                <Text key={`${s.id}-blocked-tail-${idx}`} dimColor>{line}</Text>
              ))}
            </Box>
          )}
          <Text dimColor>{'  '}actions: open-terminal · retry-with-auto (stub) · abort (stub)</Text>
        </Box>
      ))}
      <Text dimColor>q: back</Text>
    </Box>
  );
}

function formatTailLines(rawTail: string, maxLines = 16, maxLineLength = 160): string[] {
  return rawTail
    .split('\n')
    .slice(-maxLines)
    .map((line) => line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}...` : line);
}
