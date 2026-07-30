import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';
import { usePagedView } from '../usePagedView.js';
import { useTerminalSize } from '../useTerminalSize.js';

export function BlockedConsole({ state, sessionId, onBack }: {
  state: TuiState; sessionId: string; onBack: () => void;
}) {
  const { columns, rows } = useTerminalSize();
  const blocked = state.subagents[sessionId]?.filter((s) => s.blocked) ?? [];
  const lines = blocked.flatMap((subagent) => [
    { key: `blocked-${subagent.id}`, text: `  ${subagent.alias} (${subagent.cliType}) — BLOCKED`, color: 'red' as const },
    ...(subagent.rawTail
      ? [
          { key: `tail-heading-${subagent.id}`, text: '    raw_tail:', dimColor: true },
          ...formatTailLines(subagent.rawTail).map((line, index) => ({
            key: `tail-${subagent.id}-${index}`,
            text: `    ${line}`,
            dimColor: true,
          })),
        ]
      : []),
    {
      key: `actions-${subagent.id}`,
      text: '  actions: open-terminal · retry-with-auto (stub) · abort (stub)',
      dimColor: true,
    },
  ]);
  const bodyRows = Math.max(1, rows - 2);
  const { pageWindow, followingEnd, movePage, followEnd } = usePagedView(lines.length, bodyRows, true);

  useInput((input, key) => {
    if (input === 'q') onBack();
    if (input === 'f') followEnd();
    if (key.upArrow || key.pageUp) movePage(-1);
    if (key.downArrow || key.pageDown) movePage(1);
  });

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Text bold wrap="truncate-end">Native Blocked Console — {sessionId.slice(0, 12)}</Text>
      <Box flexDirection="column" height={bodyRows} overflow="hidden">
        {blocked.length === 0 && <Text dimColor>No blocked subagents.</Text>}
        {lines.slice(pageWindow.start, pageWindow.end).map((line) => (
          <Text key={line.key} color={line.color} dimColor={line.dimColor} wrap="truncate-end">
            {line.text}
          </Text>
        ))}
      </Box>
      <Text dimColor wrap="truncate-end">
        ↑↓/PgUp/PgDn page · f: follow latest · q: back · {pageWindow.page + 1}/{pageWindow.pageCount}{followingEnd ? ' [following]' : ''}
      </Text>
    </Box>
  );
}

function formatTailLines(rawTail: string, maxLines = 16, maxLineLength = 160): string[] {
  return rawTail
    .split('\n')
    .slice(-maxLines)
    .map((line) => line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}...` : line);
}
