import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { TuiState } from '../store.js';
import { usePagedView } from '../usePagedView.js';
import { useTerminalSize } from '../useTerminalSize.js';

interface DetailLine {
  key: string;
  text: string;
  color?: 'green' | 'red';
  dimColor?: boolean;
  bold?: boolean;
  underline?: boolean;
}

export function SessionDetail({ state, sessionId, baseUrl, onChoice, onBlocked, onBack }: {
  state: TuiState; sessionId: string; baseUrl: string;
  onChoice: () => void; onBlocked: () => void; onBack: () => void;
}) {
  const { columns, rows } = useTerminalSize();
  const bodyRows = Math.max(1, rows - 2);
  const lines = buildSessionDetailLines(state, sessionId);
  const { pageWindow, followingEnd, movePage, followEnd } = usePagedView(lines.length, bodyRows, true);

  useInput((input, key) => {
    if (input === 'c') onChoice();
    if (input === 'b') onBlocked();
    if (input === 'q') onBack();
    if (input === 'f') followEnd();
    if (key.upArrow || key.pageUp) movePage(-1);
    if (key.downArrow || key.pageDown) movePage(1);
  });
  const session = state.sessions[sessionId];

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Text bold wrap="truncate-end">Session {sessionId.slice(0, 12)} — {session?.task ?? '?'}</Text>
      <Box flexDirection="column" height={bodyRows} overflow="hidden">
        {lines.slice(pageWindow.start, pageWindow.end).map((line) => (
          <Text
            key={line.key}
            color={line.color}
            dimColor={line.dimColor}
            bold={line.bold}
            underline={line.underline}
            wrap="truncate-end"
          >
            {line.text || ' '}
          </Text>
        ))}
      </Box>
      <Text dimColor wrap="truncate-end">
        ↑↓/PgUp/PgDn page · f: follow latest · c: choices · b: blocked · q: back · {pageWindow.page + 1}/{pageWindow.pageCount}{followingEnd ? ' [following]' : ''}
      </Text>
    </Box>
  );
}

export function buildSessionDetailLines(state: TuiState, sessionId: string): DetailLine[] {
  const msgs = state.messages[sessionId] ?? [];
  const subs = state.subagents[sessionId] ?? [];
  const choices = state.choices[sessionId] ?? [];
  const arts = state.artifacts[sessionId] ?? [];
  const lines: DetailLine[] = [];

  lines.push({ key: 'subagents-heading', text: `Subagents (${subs.length})`, bold: true, underline: true });
  if (subs.length === 0) lines.push({ key: 'subagents-empty', text: '  No subagents.', dimColor: true });
  for (const subagent of subs) {
    lines.push({
      key: `subagent-${subagent.id}`,
      text: `  ${subagent.alias} (${subagent.cliType}): ${subagent.status}${subagent.blocked ? ' [BLOCKED]' : ''}`,
      color: subagent.blocked ? 'red' : subagent.status === 'completed' ? 'green' : undefined,
    });
  }

  lines.push({ key: 'messages-spacer', text: '' });
  lines.push({ key: 'messages-heading', text: `Messages (${msgs.length})`, bold: true, underline: true });
  for (const message of msgs.slice(-10)) {
    lines.push({ key: `message-${message.id}`, text: `  ${message.kind}`, dimColor: true });
  }

  lines.push({ key: 'choices-spacer', text: '' });
  lines.push({ key: 'choices-heading', text: `Choices (${choices.length})`, bold: true, underline: true });
  for (const choice of choices) {
    lines.push({
      key: `choice-${choice.id}`,
      text: `  ${choice.question.slice(0, 50)} — ${choice.status}${choice.selected ? ` (${choice.selected})` : ''}`,
    });
  }

  if (arts.length > 0) {
    lines.push({ key: 'artifacts-spacer', text: '' });
    lines.push({ key: 'artifacts-heading', text: `Artifacts (${arts.length})`, bold: true, underline: true });
    for (const artifact of arts) {
      lines.push({ key: `artifact-${artifact.id}`, text: `  ${artifact.id.slice(0, 12)} (${artifact.kind})`, dimColor: true });
    }
  }

  const tails = subs
    .filter((subagent) => subagent.rawTail)
    .sort((left, right) => outputTimestamp(left.lastOutputAt) - outputTimestamp(right.lastOutputAt));
  if (tails.length > 0) {
    lines.push({ key: 'tails-spacer', text: '' });
    lines.push({ key: 'tails-heading', text: 'Live output tails', bold: true, underline: true });
    for (const subagent of tails) {
      lines.push({ key: `tail-heading-${subagent.id}`, text: `  ${subagent.alias} (${subagent.cliType})`, dimColor: true });
      for (const [index, line] of formatTailLines(subagent.rawTail!).entries()) {
        lines.push({ key: `tail-${subagent.id}-${index}`, text: `    ${line}`, dimColor: true });
      }
    }
  }

  return lines;
}

function outputTimestamp(value: string | null): number {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatTailLines(rawTail: string, maxLines = 8, maxLineLength = 140): string[] {
  return rawTail
    .split('\n')
    .slice(-maxLines)
    .map((line) => line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}...` : line);
}
