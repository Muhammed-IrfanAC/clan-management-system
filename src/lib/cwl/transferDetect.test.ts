import { describe, it, expect } from 'vitest';
import { detectTransferOutcomes, type TransferObservation } from './transferDetect';

const SYNCED = new Set(['warriors', 'academy']);

function obs(over: Partial<TransferObservation> = {}): TransferObservation {
  return {
    transferId: 't1',
    allocationId: 'a1',
    status: 'pending',
    toClanId: 'warriors',
    actualClanId: 'academy',
    accountStatus: 'active',
    ...over,
  };
}

describe('detectTransferOutcomes', () => {
  it('confirms a pending move once the account is seen in the destination clan', () => {
    const [out] = detectTransferOutcomes([obs({ actualClanId: 'warriors' })], SYNCED);
    expect(out).toMatchObject({
      transferId: 't1',
      allocationId: 'a1',
      transferStatus: 'done',
      allocationStatus: 'transferred',
      arrived: true,
    });
  });

  it('leaves a pending move alone while the account is still in the old clan', () => {
    expect(detectTransferOutcomes([obs()], SYNCED)).toEqual([]);
  });

  it('does not write a move that is already recorded correctly', () => {
    expect(detectTransferOutcomes([obs({ status: 'done', actualClanId: 'warriors' })], SYNCED)).toEqual([]);
  });

  it('reopens a confirmed move when the account has left again', () => {
    // The sync marks a departed row 'left' but leaves clan_id pointing at the clan they left, so the
    // account still reads as being in the destination — status is what catches this.
    const [out] = detectTransferOutcomes(
      [obs({ status: 'done', actualClanId: 'warriors', accountStatus: 'left' })],
      SYNCED,
    );
    expect(out).toMatchObject({ transferStatus: 'pending', allocationStatus: 'transfer_required', arrived: false });
  });

  it('reopens a confirmed move when the account turns up in a different clan', () => {
    const [out] = detectTransferOutcomes([obs({ status: 'done', actualClanId: 'academy' })], SYNCED);
    expect(out.arrived).toBe(false);
  });

  it('never judges a transfer into a clan we do not sync — in either direction', () => {
    const arrived = obs({ toClanId: 'ghost', actualClanId: 'ghost' });
    const departed = obs({ status: 'done', toClanId: 'ghost', actualClanId: 'academy' });
    expect(detectTransferOutcomes([arrived, departed], SYNCED)).toEqual([]);
  });

  it('ignores a transfer with no destination', () => {
    expect(detectTransferOutcomes([obs({ toClanId: null, actualClanId: null })], SYNCED)).toEqual([]);
  });

  it('leaves a missed transfer untouched — that state is a leader’s judgement, not an observation', () => {
    expect(detectTransferOutcomes([obs({ status: 'missed', actualClanId: 'warriors' })], SYNCED)).toEqual([]);
  });

  it('treats an account never synced into any clan as not arrived', () => {
    expect(detectTransferOutcomes([obs({ actualClanId: null })], SYNCED)).toEqual([]);
    const [out] = detectTransferOutcomes([obs({ status: 'done', actualClanId: null })], SYNCED);
    expect(out.arrived).toBe(false);
  });

  it('returns only the rows that changed out of a mixed batch', () => {
    const outcomes = detectTransferOutcomes(
      [
        obs({ transferId: 'moved', actualClanId: 'warriors' }),
        obs({ transferId: 'waiting' }),
        obs({ transferId: 'settled', status: 'done', actualClanId: 'warriors' }),
        obs({ transferId: 'bounced', status: 'done', actualClanId: 'academy' }),
      ],
      SYNCED,
    );
    expect(outcomes.map((o) => o.transferId)).toEqual(['moved', 'bounced']);
  });
});
