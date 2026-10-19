import { describe, it, expect } from 'vitest';
import { COLOR_RESOLVED, stampResolution, withoutOption } from './resolution';
import type { DiscordActionRow } from '../types';

const ALERT = {
  content: '<@&1> A kicked player joined',
  embeds: [{ title: 'Kicked player joined', color: 0xef4444, fields: [{ name: 'Reason', value: 'griefing' }] }],
};

const select = (values: string[]): DiscordActionRow[] => [{
  type: 1,
  components: [{ type: 3, custom_id: 'unl:v1:pick', options: values.map((v) => ({ label: v, value: v })) }],
}];

describe('stampResolution', () => {
  it('adds an Actions field, recolours, drops the buttons and keeps the alert text', () => {
    const r = stampResolution(ALERT, '✅ Handled by <@9>');
    expect(r.content).toBe(ALERT.content);
    expect(r.components).toEqual([]);
    expect(r.allowed_mentions).toEqual({ parse: [] });
    expect(r.embeds![0].color).toBe(COLOR_RESOLVED);
    expect(r.embeds![0].fields).toEqual([
      { name: 'Reason', value: 'griefing' },
      { name: 'Actions', value: '✅ Handled by <@9>', inline: false },
    ]);
  });

  it('appends to an existing Actions field and can leave the alert open', () => {
    const once = stampResolution(ALERT, 'first', { stillOpen: true, components: select(['#B']) });
    const twice = stampResolution(once, 'second', { stillOpen: true });
    expect(twice.embeds![0].fields!.filter((f) => f.name === 'Actions')).toEqual([{ name: 'Actions', value: 'first\nsecond', inline: false }]);
    expect(twice.embeds![0].color).toBe(0xef4444);
    expect(once.components).toEqual(select(['#B']));
  });

  it('keeps the newest lines when the field overflows', () => {
    let msg = stampResolution(ALERT, 'line 0');
    for (let n = 1; n < 60; n++) msg = stampResolution(msg, `line ${n} ${'x'.repeat(20)}`);
    const value = msg.embeds![0].fields!.find((f) => f.name === 'Actions')!.value;
    expect(value.length).toBeLessThanOrEqual(1024);
    expect(value).toMatch(/line 59 x+$/);
    expect(value.startsWith('…')).toBe(true);
  });
});

describe('withoutOption', () => {
  it('removes the option, and the row once the select is empty', () => {
    expect(withoutOption(select(['#A', '#B']), 'unl:v1:pick', '#A')).toEqual([{
      type: 1,
      components: [{ type: 3, custom_id: 'unl:v1:pick', options: [{ label: '#B', value: '#B' }], max_values: 1 }],
    }]);
    expect(withoutOption(select(['#A']), 'unl:v1:pick', '#A')).toEqual([]);
  });
});
