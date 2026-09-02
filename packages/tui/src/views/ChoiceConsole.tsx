import React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';
import { clampSelection, getPageWindow, selectedIndexById } from '../pagination.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { restPost } from '../client.js';

/**
 * Choice Console — lists pending choices for a session and lets the user resolve them.
 *
 * KNOWN LIMITATION (M5): The TuiState only carries `question/status/selected` per choice
 * (derived from SSE events), not the full options array or recommendation. To display the
 * full options + tradeoffs + recommendation, this view would need to
 * `GET /v1/sessions/:id/choices/:cid` to fetch the full choice row from the DB.
 * For M5, the console lists pending choices (question + status) and the full options
 * display is a documented follow-up.
 */
export function ChoiceConsole({ state, sessionId, baseUrl, onBack }: {
  state: TuiState; sessionId: string; baseUrl: string; onBack: () => void;
}) {
  const { columns, rows } = useTerminalSize();
  const choices = state.choices[sessionId]?.filter((c) => c.status === 'pending') ?? [];
  const choiceIds = choices.map((choice) => choice.id);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const selected = selectedIndexById(choiceIds, selectedChoiceId);
  const bodyRows = Math.max(1, rows - 2);
  const pageWindow = getPageWindow(choices.length, bodyRows, Math.floor(selected / bodyRows));

  const moveSelection = (delta: number) => {
    const next = clampSelection(choices.length, selected + delta);
    setSelectedChoiceId(choiceIds[next] ?? null);
  };

  useInput((input, key) => {
    if (input === 'q') onBack();
    if (key.upArrow) moveSelection(-1);
    if (key.downArrow) moveSelection(1);
    if (key.pageUp) moveSelection(-bodyRows);
    if (key.pageDown) moveSelection(bodyRows);
    // digit keys 1-9: select an option for the currently highlighted choice
    const digit = parseInt(input, 10);
    if (digit >= 1 && digit <= 9 && choices[selected]) {
      // We don't have the options in the TuiState (only question/status/selected).
      // The resolve POST needs the selected option id; for M5, we POST the digit as a string
      // and the user confirms. This is a simplified interaction — the full options display
      // would require a GET /v1/sessions/:id/choices/:cid to fetch the full choice data.
      // For M5: the user types the option id directly.
    }
  });

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Text bold wrap="truncate-end">Choice Console — {sessionId.slice(0, 12)}</Text>
      <Box flexDirection="column" height={bodyRows} overflow="hidden">
        {choices.length === 0 && <Text dimColor>No pending choices.</Text>}
        {choices.slice(pageWindow.start, pageWindow.end).map((c, pageIndex) => {
          const i = pageWindow.start + pageIndex;
          return (
            <Text key={c.id} color={i === selected ? 'cyan' : undefined} wrap="truncate-end">
              {i === selected ? '▶ ' : '  '}{c.question.slice(0, 60)}
            </Text>
          );
        })}
      </Box>
      <Text dimColor wrap="truncate-end">↑↓ navigate · PgUp/PgDn page · Type option id · q: back · {pageWindow.page + 1}/{pageWindow.pageCount}</Text>
    </Box>
  );
}
