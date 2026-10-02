import { describe, expect, it } from 'vitest';
import { workflowContextTool } from './workflowContextTool';

describe('preserved workflow context', () => {
  it('pages through the entire original request and later amendments', async () => {
    const conversation=[{role:'user',content:'original requirement '+ 'x'.repeat(50000)},{role:'user',content:'final amendment'}];
    const tool=workflowContextTool(conversation,'handover');
    let offset: number|null=0;
    let restored='';
    while(offset!==null){
      const result=await tool({offset,limit:3000}, {} as never);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(String(result.error));
      const page=JSON.parse(result.output as string);
      restored+=page.content;offset=page.next_offset;
    }
    expect(JSON.parse(restored)).toEqual({conversation,handover:'handover'});
    expect((await tool({offset:-1},{} as never)).ok).toBe(false);
  });
});
