import React from 'react';
import { useState } from 'react';
import { useEvents } from './useEvents.js';
import { SessionList } from './views/SessionList.js';
import { SessionDetail } from './views/SessionDetail.js';
import { ChoiceConsole } from './views/ChoiceConsole.js';
import { BlockedConsole } from './views/BlockedConsole.js';

type View = { name: 'list' } | { name: 'detail'; sessionId: string } | { name: 'choice'; sessionId: string } | { name: 'blocked'; sessionId: string };

export function App({ baseUrl }: { baseUrl: string }) {
  const state = useEvents(baseUrl);
  const [view, setView] = useState<View>({ name: 'list' });

  switch (view.name) {
    case 'list':
      return <SessionList state={state} onSelect={(sid) => setView({ name: 'detail', sessionId: sid })} />;
    case 'detail':
      return <SessionDetail state={state} sessionId={view.sessionId} baseUrl={baseUrl}
        onChoice={() => setView({ name: 'choice', sessionId: view.sessionId })}
        onBlocked={() => setView({ name: 'blocked', sessionId: view.sessionId })}
        onBack={() => setView({ name: 'list' })} />;
    case 'choice':
      return <ChoiceConsole state={state} sessionId={view.sessionId} baseUrl={baseUrl} onBack={() => setView({ name: 'detail', sessionId: view.sessionId })} />;
    case 'blocked':
      return <BlockedConsole state={state} sessionId={view.sessionId} onBack={() => setView({ name: 'detail', sessionId: view.sessionId })} />;
  }
}
