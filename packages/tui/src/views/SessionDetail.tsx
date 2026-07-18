import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';

export function SessionDetail({ state, sessionId, baseUrl, onChoice, onBlocked, onBack }: {
  state: TuiState; sessionId: string; baseUrl: string;
  onChoice: () => void; onBlocked: () => void; onBack: () => void;
}) {
  useInput((input) => {
    if (input === 'c') onChoice();
    if (input === 'b') onBlocked();
    if (input === 'q') onBack();
  });
  const msgs = state.messages[sessionId] ?? [];
  const subs = state.subagents[sessionId] ?? [];
  const choices = state.choices[sessionId] ?? [];
  const arts = state.artifacts[sessionId] ?? [];
  const session = state.sessions[sessionId];

  return (
    <Box flexDirection="column">
      <Text bold>Session {sessionId.slice(0, 12)} — {session?.task ?? '?'}</Text>
      <Text> </Text>
      <Text bold underline>Subagents</Text>
      {subs.map((s) => (
        <Box key={s.id} flexDirection="column">
          <Text color={s.blocked ? 'red' : s.status === 'completed' ? 'green' : undefined}>
            {'  '}{s.alias} ({s.cliType}): {s.status}{s.blocked ? ' [BLOCKED]' : ''}
          </Text>
          {s.rawTail && (
            <Box marginLeft={4} flexDirection="column">
              <Text dimColor>tail:</Text>
              {formatTailLines(s.rawTail).map((line, idx) => (
                <Text key={`${s.id}-tail-${idx}`} dimColor>{line}</Text>
              ))}
            </Box>
          )}
        </Box>
      ))}
      <Text> </Text>
      <Text bold underline>Messages ({msgs.length})</Text>
      {msgs.slice(-10).map((m) => (
        <Text key={m.id} dimColor>{'  '}{m.kind}</Text>
      ))}
      <Text> </Text>
      <Text bold underline>Choices ({choices.length})</Text>
      {choices.map((c) => (
        <Text key={c.id}>{'  '}{c.question.slice(0, 50)} — {c.status}{c.selected ? ` (${c.selected})` : ''}</Text>
      ))}
      {arts.length > 0 && (<><Text> </Text><Text bold underline>Artifacts ({arts.length})</Text>
        {arts.map((a) => <Text key={a.id} dimColor>{'  '}{a.id.slice(0, 12)} ({a.kind})</Text>)}</>)}
      <Text> </Text>
      <Text dimColor>c: choices · b: blocked · q: back</Text>
    </Box>
  );
}

function formatTailLines(rawTail: string, maxLines = 8, maxLineLength = 140): string[] {
  return rawTail
    .split('\n')
    .slice(-maxLines)
    .map((line) => line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}...` : line);
}
