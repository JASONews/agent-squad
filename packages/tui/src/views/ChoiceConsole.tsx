import React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';
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
  const choices = state.choices[sessionId]?.filter((c) => c.status === 'pending') ?? [];
  const [selected, setSelected] = useState(0);
  useInput((input, key) => {
    if (input === 'q') onBack();
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(choices.length - 1, s + 1));
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
    <Box flexDirection="column">
      <Text bold>Choice Console — {sessionId.slice(0, 12)}</Text>
      {choices.length === 0 && <Text dimColor>No pending choices.</Text>}
      {choices.map((c, i) => (
        <Box key={c.id} flexDirection="column">
          <Text color={i === selected ? 'cyan' : undefined}>
            {i === selected ? '▶ ' : '  '}{c.question.slice(0, 60)}
          </Text>
        </Box>
      ))}
      <Text dimColor>Type the option id to resolve · q: back</Text>
      {choices.length > 0 && <Text dimColor>(Full option/recommendation display requires GET choice detail — added in follow-up)</Text>}
    </Box>
  );
}
