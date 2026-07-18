import React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';

export function formatLastActiveTime(value: string | null, now = new Date()): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '-';
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function SessionList({ state, onSelect }: { state: TuiState; onSelect: (sessionId: string) => void }) {
  const sessionIds = Object.keys(state.sessions);
  const [selected, setSelected] = useState(0);
  useInput((input, key) => {
    if (input === 'q') process.exit(0);
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(sessionIds.length - 1, s + 1));
    if (key.return && sessionIds[selected]) onSelect(sessionIds[selected]);
  });
  return (
    <Box flexDirection="column">
      <Text bold>Agent Squad — Sessions</Text>
      {sessionIds.length === 0 && <Text dimColor>No sessions. Waiting for events…</Text>}
      {sessionIds.map((sid, i) => {
        const s = state.sessions[sid]!; // sid from Object.keys(sessions) — guaranteed present
        const subCount = state.subagents[sid]?.length ?? 0;
        const pendingChoices = state.choices[sid]?.filter((c) => c.status === 'pending').length ?? 0;
        const blocked = state.subagents[sid]?.filter((s) => s.blocked).length ?? 0;
        return (
          <Box key={sid} flexDirection="column">
            <Text color={i === selected ? 'cyan' : undefined}>
              {i === selected ? '▶ ' : '  '}{sid.slice(0, 12)}  {s.task.slice(0, 40)}
            </Text>
            <Text dimColor>     last active: {formatLastActiveTime(s.lastActiveAt)}  subs: {subCount}  choices: {pendingChoices}  blocked: {blocked}</Text>
          </Box>
        );
      })}
      <Text dimColor>↑↓ navigate · Enter: detail · q: quit</Text>
    </Box>
  );
}
