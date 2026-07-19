#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { PROTOCOL_VERSION, agent, methods, ndJsonStream } from '@agentclientprotocol/sdk';

const args = process.argv.slice(2);

if (args[0] === '--version') {
  if (process.env.FAKE_KIMI_VERSION_MODE === 'hang') {
    await new Promise(() => {});
  }
  process.stdout.write('kimi code 0.24.1\n');
  process.exit(0);
}

if (args[0] !== 'acp') {
  process.stderr.write(`expected kimi acp, received: ${args.join(' ')}\n`);
  process.exit(2);
}

function record(event) {
  if (process.env.FAKE_KIMI_EVENTS_FILE) {
    appendFileSync(process.env.FAKE_KIMI_EVENTS_FILE, `${JSON.stringify(event)}\n`);
  }
}

function configOptions(model = 'default', thinking = 'off') {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: [
        { value: 'default', name: 'Default' },
        { value: 'kimi-k2.5', name: 'Kimi K2.5' },
      ],
    },
    {
      id: 'thinking',
      name: 'Thinking',
      category: 'thought_level',
      type: 'select',
      currentValue: thinking,
      options: [
        { value: 'on', name: 'On' },
        { value: 'off', name: 'Off' },
      ],
    },
  ];
}

let selectedModel = 'default';
let selectedThinking = 'off';
let pendingPrompt;

const app = agent({ name: 'fake-kimi' })
  .onRequest(methods.agent.initialize, ({ params }) => {
    record({ method: 'initialize', params });
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        sessionCapabilities: { resume: {}, configOptions: {} },
      },
      agentInfo: { name: 'fake-kimi', version: '0.24.1' },
    };
  })
  .onRequest(methods.agent.session.new, ({ params }) => {
    record({ method: 'session/new', params });
    return { sessionId: 'fake-kimi-session', configOptions: configOptions() };
  })
  .onRequest(methods.agent.session.resume, ({ params }) => {
    record({ method: 'session/resume', params });
    return { configOptions: configOptions() };
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    record({ method: 'session/set_config_option', params });
    if (params.configId === 'model') selectedModel = String(params.value);
    if (params.configId === 'thinking') selectedThinking = String(params.value);
    return { configOptions: configOptions(selectedModel, selectedThinking) };
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    record({ method: 'session/prompt', params });

    if (process.env.FAKE_KIMI_PERMISSION_KIND) {
      const outcome = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: 'tool-1',
          title: `Use ${process.env.FAKE_KIMI_PERMISSION_KIND} tool`,
          status: 'pending',
        },
        options: [
          { optionId: 'approve_once', name: 'Approve once', kind: 'allow_once' },
          { optionId: 'approve_always', name: 'Approve for this session', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      });
      record({ method: 'permission/outcome', outcome });
      if (process.env.FAKE_KIMI_PERMISSION_FILE) {
        writeFileSync(process.env.FAKE_KIMI_PERMISSION_FILE, JSON.stringify(outcome));
      }
    }

    if (process.env.FAKE_KIMI_MODE === 'question') {
      const questionResult = new Promise((resolvePrompt) => { pendingPrompt = resolvePrompt; });
      const outcome = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: 'ask-user',
          title: 'AskUserQuestion',
          content: [{ type: 'content', content: { type: 'text', text: 'Which implementation should I use?' } }],
        },
        options: [
          { optionId: 'q0_opt_0', name: 'Use ACP', kind: 'allow_once' },
          { optionId: 'q0_opt_1', name: 'Use JSONL', kind: 'allow_once' },
          { optionId: 'q0_skip', name: 'Skip', kind: 'reject_once' },
        ],
      });
      record({ method: 'question/outcome', outcome });
      return await questionResult;
    }

    if (process.env.FAKE_KIMI_MODE === 'refusal') {
      return { stopReason: 'refusal' };
    }

    if (process.env.FAKE_KIMI_MODE === 'timeout') {
      if (process.env.FAKE_KIMI_DESCENDANT_PID_FILE) {
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        writeFileSync(process.env.FAKE_KIMI_DESCENDANT_PID_FILE, String(descendant.pid));
      }
      return await new Promise((resolvePrompt) => { pendingPrompt = resolvePrompt; });
    }

    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Inspecting repository' },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-2',
        title: 'Read source',
        kind: 'read',
        status: 'in_progress',
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'fake Kimi ' },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'reply' },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    record({ method: 'session/cancel', params });
    if (process.env.FAKE_KIMI_CANCEL_FILE) writeFileSync(process.env.FAKE_KIMI_CANCEL_FILE, params.sessionId);
    pendingPrompt?.({ stopReason: 'cancelled' });
    pendingPrompt = undefined;
  });

const connection = app.connect(ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
await connection.closed;
