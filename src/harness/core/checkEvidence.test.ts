import { describe, expect, it, vi } from 'vitest';
import { CheckEvidenceLedger } from './checkEvidence';

describe('host check evidence', () => {
  it('reuses only a successful check with unchanged inputs and identical selection', async () => {
    const ledger = new CheckEvidenceLedger(async () => 'state-a');
    const state = await ledger.fingerprint();
    const receipt = ledger.record('test:focused', state, state, { ok: true, output: 'passed' });
    expect(ledger.find('test:focused',state)).toBe(receipt);
    expect(ledger.find('test:full',state)).toBeUndefined();
    expect(ledger.find('test:focused','state-b')).toBeUndefined();
    ledger.record('test:focused', state, state, { ok: false, error: 'fresh check failed' });
    expect(ledger.find('test:focused',state)).toBeUndefined();
    ledger.record('test:focused', state, state, { ok: true, output: 'passed again' });
    ledger.invalidate();
    expect(ledger.find('test:focused',state)).toBeUndefined();
  });
  it('never trusts failed, unknown, changing or expired checks', async () => {
    const ledger = new CheckEvidenceLedger(async () => { throw new Error('unreadable input'); });
    expect(await ledger.fingerprint()).toBeUndefined();
    expect(ledger.record('test', undefined, undefined, { ok:true, output:'passed' })).toBeUndefined();
    expect(ledger.record('test','a','b',{ok:true,output:'passed'})).toBeUndefined();
    expect(ledger.record('test','a','a',{ok:false,error:'failed'})).toBeUndefined();
    ledger.record('test','a','a',{ok:true,output:'passed'});
    const now = vi.spyOn(Date,'now').mockReturnValue(Date.now()+301000);
    expect(ledger.find('test','a')).toBeUndefined();
    now.mockRestore();
  });
});
