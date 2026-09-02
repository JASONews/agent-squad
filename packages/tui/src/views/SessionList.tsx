import React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionSummary, TuiState } from '../store.js';
import { clampSelection, getPageWindow, selectedIndexById } from '../pagination.js';
import { useTerminalSize } from '../useTerminalSize.js';

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

export function sortSessionIdsByActivity(sessions: Record<string, SessionSummary>): string[] {
  return Object.keys(sessions).sort((left, right) => {
    const leftTime = Date.parse(sessions[left]?.lastActiveAt ?? '');
    const rightTime = Date.parse(sessions[right]?.lastActiveAt ?? '');
    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
    return safeRight - safeLeft || left.localeCompare(right);
  });
}

export function SessionList({ state, onSelect }: { state: TuiState; onSelect: (sessionId: string) => void }) {
  const { columns, rows } = useTerminalSize();
  const sessionIds = sortSessionIdsByActivity(state.sessions);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selected = selectedIndexById(sessionIds, selectedSessionId);
  const followingLatest = selectedSessionId === null || !sessionIds.includes(selectedSessionId);
  const bodyRows = Math.max(1, rows - 2);
  const pageSize = Math.max(1, Math.floor(bodyRows / 2));
  const pageWindow = getPageWindow(sessionIds.length, pageSize, Math.floor(selected / pageSize));

  const moveSelection = (delta: number) => {
    const next = clampSelection(sessionIds.length, selected + delta);
    if (next !== selected || !followingLatest) setSelectedSessionId(sessionIds[next] ?? null);
  };

  useInput((input, key) => {
    if (input === 'q') process.exit(0);
    if (input === 'f') setSelectedSessionId(null);
    if (key.upArrow) moveSelection(-1);
    if (key.downArrow) moveSelection(1);
    if (key.pageUp) moveSelection(-pageSize);
    if (key.pageDown) moveSelection(pageSize);
    if (key.return && sessionIds[selected]) onSelect(sessionIds[selected]);
  });

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Text bold wrap="truncate-end">Agent Squad — Sessions ({sessionIds.length})</Text>
      <Box flexDirection="column" height={bodyRows} overflow="hidden">
        {sessionIds.length === 0 && <Text dimColor>No sessions. Waiting for events…</Text>}
        {sessionIds.slice(pageWindow.start, pageWindow.end).map((sid, pageIndex) => {
          const i = pageWindow.start + pageIndex;
          const s = state.sessions[sid]!; // sid from Object.keys(sessions) — guaranteed present
          const subCount = state.subagents[sid]?.length ?? 0;
          const pendingChoices = state.choices[sid]?.filter((c) => c.status === 'pending').length ?? 0;
          const blocked = state.subagents[sid]?.filter((s) => s.blocked).length ?? 0;
          return (
            <Box key={sid} flexDirection="column" height={2} overflow="hidden">
              <Text color={i === selected ? 'cyan' : undefined} wrap="truncate-end">
                {i === selected ? '▶ ' : '  '}{sid.slice(0, 12)}  {s.task.slice(0, 40)}
              </Text>
              <Text dimColor wrap="truncate-end">     last active: {formatLastActiveTime(s.lastActiveAt)}  subs: {subCount}  choices: {pendingChoices}  blocked: {blocked}</Text>
            </Box>
          );
        })}
      </Box>
      <Text dimColor wrap="truncate-end">↑↓ navigate · PgUp/PgDn page · f: latest · Enter: detail · q: quit · {pageWindow.page + 1}/{pageWindow.pageCount}{followingLatest ? ' [following]' : ''}</Text>
    </Box>
  );
}
