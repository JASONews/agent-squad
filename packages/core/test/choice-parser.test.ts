import { describe, it, expect } from 'vitest';
import { parseChoiceFromReply, parseChoicesFromReply } from '../src/choice-parser.js';

describe('parseChoiceFromReply', () => {
  it('parses a valid choice block and removes it from the reply', () => {
    const reply = `I need to decide on the UI layout.

%%AGENT_SQUAD_CHOICE%%
{"question":"Modal or standalone page?","options":[{"id":"modal","label":"Modal","tradeoff":"lighter"},{"id":"page","label":"Standalone Page","tradeoff":"more space"}],"recommendation":{"option_id":"page","reason":"better for complex forms","confidence":"high"}}
%%END_AGENT_SQUAD_CHOICE%%`;
    const { choice, cleanedReply } = parseChoiceFromReply(reply);
    expect(choice).not.toBeNull();
    expect(choice!.question).toBe('Modal or standalone page?');
    expect(choice!.options).toHaveLength(2);
    expect(choice!.options[0].id).toBe('modal');
    expect(choice!.recommendation?.option_id).toBe('page');
    expect(cleanedReply).toBe('I need to decide on the UI layout.');
  });

  it('returns null when no choice block present', () => {
    const { choice, cleanedReply } = parseChoiceFromReply('just a normal reply');
    expect(choice).toBeNull();
    expect(cleanedReply).toBe('just a normal reply');
  });

  it('returns null when block has invalid JSON', () => {
    const reply = `%%AGENT_SQUAD_CHOICE%%\nnot json\n%%END_AGENT_SQUAD_CHOICE%%`;
    const { choice } = parseChoiceFromReply(reply);
    expect(choice).toBeNull();
  });

  it('returns null when block has no options', () => {
    const reply = `%%AGENT_SQUAD_CHOICE%%\n{"question":"q?","options":[]}\n%%END_AGENT_SQUAD_CHOICE%%`;
    const { choice } = parseChoiceFromReply(reply);
    expect(choice).toBeNull();
  });

  it('handles missing end marker gracefully', () => {
    const reply = `%%AGENT_SQUAD_CHOICE%%\n{"question":"q?","options":[{"id":"a","label":"A"}]}`;
    const { choice, cleanedReply } = parseChoiceFromReply(reply);
    expect(choice).toBeNull();
    expect(cleanedReply).toBe(reply);
  });

  it('parses without recommendation', () => {
    const reply = `%%AGENT_SQUAD_CHOICE%%\n{"question":"q?","options":[{"id":"a","label":"A"}]}\n%%END_AGENT_SQUAD_CHOICE%%`;
    const { choice } = parseChoiceFromReply(reply);
    expect(choice).not.toBeNull();
    expect(choice!.recommendation).toBeUndefined();
  });

  it('parses multiple choice blocks and removes them all from the reply', () => {
    const reply = `Need two decisions.

%%AGENT_SQUAD_CHOICE%%
{"question":"Layout?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}]}
%%END_AGENT_SQUAD_CHOICE%%

Some context between choices.

%%AGENT_SQUAD_CHOICE%%
{"question":"Tone?","options":[{"id":"dense","label":"Dense"},{"id":"guided","label":"Guided"}],"recommendation":{"option_id":"dense","reason":"repeat users","confidence":"medium"}}
%%END_AGENT_SQUAD_CHOICE%%

Done.`;
    const { choices, cleanedReply } = parseChoicesFromReply(reply);
    expect(choices.map((c) => c.question)).toEqual(['Layout?', 'Tone?']);
    expect(choices[0].options.map((o) => o.id)).toEqual(['modal', 'page']);
    expect(choices[1].recommendation?.option_id).toBe('dense');
    expect(cleanedReply).toBe('Need two decisions.\n\nSome context between choices.\n\nDone.');
  });
});
