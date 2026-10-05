// The active workflow graph has one source. Generated JSON is shared by the
// canvas and native host. Legacy snapshots are migration/test fixtures only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/tabs/behaviors/starter');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const string = {type:'string',minLength:1};
const array = items => ({type:'array',items});
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const verdictSchema=object({verdict:string,criteria:array(object({id:string,status:{type:'string',enum:['pass','fail','unverified']},evidence:string})),summary:string});
const schema=(name,value)=>({type:'inline',name,schema:value});
const binding=(target,node,pointer='')=>({target,source:node?{type:'node_output',node_id:node,pointer}:{type:'run_input',pointer:`/${target}`}});
const source=(node_id,pointer='')=>({type:'node_output',node_id,pointer});
const retry={max_attempts:2,retry_on:['backend_rate_limited','backend_timeout','tool_timeout','invalid_structured_output']};
const contextRule='Start from workflow_input.request.';
const reportRule='Finish with a clear summary.';
const planInstructions='Plan the request. Write the requirements with acceptance criteria, and ordered tasks that change the code. Every task must change the workspace; things only someone outside it can do (credential rotation, deployments, history rewrites) go in the summary as follow-ups for the user.';
const builderInstructions='Implement the plan in workflow_input.plan in the workspace. Read the code, make the changes, and run the project\'s checks when you can. If a command fails, read its output and try another way; do not stop before the changes are made. When Verify or a final review sends the work back, use every failed or unverified criterion and its evidence as a repair checklist. Inspect the named files, implement the missing behavior, then rerun focused checks and verify each criterion against the actual workspace. Finish with a short summary of what you changed.';
const verifyInstructions='Check that the changes in the workspace implement workflow_input.request and the plan, and that they were done properly. Run the project\'s checks when you can. Verdict: pass if it is done properly, otherwise fail followed by what is wrong.';
const catalog=[
 ['plan-build-verify',[], 'build'],['investigate',['research','analyze']],['design',['architect','plan']],['diagnose',['debug','plan']],['implement',[],'build'],['security-audit',['audit','plan']],['check-changes',['review','verify']],['analyzed-feature',['analyze'],'build'],['researched-feature',['research','architect'],'build'],['bug-fix',['debug'],'build'],['careful-change',['analyze'],'build','review'],['security-remediation',['audit'],'build','recheck'],['refactor',['analyze'],'refactor','review'],['optimize-performance',['analyze'],'optimize'],['documentation',['analyze'],'document','review'],
];
const definitions=JSON.parse(fs.readFileSync(new URL('./workflow-catalog-source.json',import.meta.url),'utf8'));
const outputs=[];
for(const [id,preps,writer,post] of catalog){
 const {stages,...old}=definitions[id];
 const workflow={...old,revision:old.revision+(writer?3:2),nodes:[],edges:[],
  // stall_timeout_ms: no sign of life from a step for 10 min cancels the attempt and retries it (waiting on a permission prompt does not count).
  policies:{max_total_attempts:40,stall_timeout_ms:600000}};
 const nodes=workflow.nodes;
 const add=n=>{n.metadata={editor:{position:{x:60+nodes.length*300,y:80}}};nodes.push(n);return n;};
 const node=(id,name,type,config,bindings=[],output=null,r={max_attempts:1,retry_on:[]})=>add({id,name,type,config,input_bindings:bindings,output_schema:output,retry:r});
 node('input','Request','input',{defaults:{attachments:[],context:''}});
 const history=[];
 const inputs=()=>[binding('request'),binding('context'),...history.map(id=>binding(id,id))];
 const gate=(id,producer,checks,repair)=>node(id,'Acceptance','verify',{checks,...(repair?{retry_target:repair}:{})},[binding('check',producer),...(history.includes('plan')?[binding('plan','plan')]:[])]);
 // Ordinary steps exchange complete prose. Only acceptance reviewers need a
 // machine-readable verdict; successful execution already controls sequencing.
 const addAgent=(id,name,profile,instructions,output=null,bindings=inputs(),extra={})=>{
  node(id,name,'agent',{instructions,tools:{type:'inherit'},context_mode:'isolated_child',structured_output:output?'host_validated':'text',profile:{id:profile},...extra},bindings,schema(id,output??{type:'string'}),retry);
  history.push(id);
 };
 for(const prep of preps){
  if(prep==='plan'){
   addAgent('plan','Plan','plan',planInstructions);
  }else{
   const oldNode=stages[prep];
   let instructions=oldNode?.instructions??'Inspect the requested scope.';
   // Do not promise nonexistent downstream bindings after graph consolidation.
   instructions=instructions.replace(/workflow_input\.(\w+)/g,(_,key)=>['request','context',...history].includes(key)?`workflow_input.${key}`:'the supplied findings');
   if(prep==='verify') instructions='Run the project\'s checks that apply to the requested changes when you can, and report what they return and whether they pass.';
   if(workflow.id==='check-changes'&&prep==='review') instructions='Review the requested changes for correctness, regressions and missing tests. Give prioritized findings with file evidence and say whether the changes are acceptable.';
   addAgent(prep,oldNode?.name??prep,oldNode?.profile??prep,`${contextRule} ${instructions} ${reportRule}`);
  }
 }
 if(writer){
  addAgent('plan','Plan','plan',planInstructions);
  addAgent('build','Build',writer,builderInstructions);
  addAgent('verify','Verify','verify',verifyInstructions,verdictSchema);
  gate('gate','verify',[{type:'required_status',pointer:'/check/verdict',equals:'pass'}]);
  if(post){
   const purpose=post==='recheck'?'Check that each original finding in workflow_input.audit is actually fixed and that the fixes add no new problem. Verdict: pass if so, otherwise fail followed by what is left.':'Review the changes in the workspace for correctness and regressions. Verdict: pass if they are fine, otherwise fail followed by the findings.';
   addAgent(post,post==='recheck'?'Security acceptance':'Final review',post==='recheck'?'security':'review',purpose,verdictSchema);
   gate(`${post}_gate`,post,[{type:'required_status',pointer:'/check/verdict',equals:'pass'}]);
  }
 }
 if(writer){
  const build=nodes.find(n=>n.id==='build');
  build.retry={max_attempts:3,retry_on:['backend_rate_limited','backend_timeout','tool_timeout','verification_failed']};
  for(const id of ['gate',...(post?[`${post}_gate`]:[])])nodes.find(n=>n.id===id).config.retry_target='build';
 }
 const last=history.at(-1);const lastAgent=nodes.find(n=>n.id===last);const pointer=lastAgent.config.structured_output==='text'?'':'/summary';
 node('output','Result','output',{source:source(last,pointer),strict:false});
 workflow.output_contract={schema:schema('result',{type:'string'}),source:source(last,pointer),strict:false};
 workflow.edges=nodes.slice(0,-1).map((n,i)=>({id:`${n.id}-${nodes[i+1].id}`,source:n.id,target:nodes[i+1].id,condition:'on_success'}));
 workflow.metadata={...workflow.metadata,orchestration:'task-queue-v1'};
 workflow.description=writer?'Plan the change, implement it in the workspace, then verify it was done properly. A failed verification sends the work back with the findings.':`${old.name}: inspect the requested scope with preserved conversation context. Findings and unknowns remain visible in the final report.`;
 const file=id==='plan-build-verify'?'plan-build-verify.workflow.json':`workflows/${id}.workflow.json`;
 outputs.push([file,workflow]);
}
const manifest={profiles:['research','analyze','plan','build','verify','review','debug','architect','security','document','refactor','optimize'].map(id=>read(`${id}.profile.json`)),workflows:outputs.map(([,d])=>d)};
const content=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(path.join(root,'catalog.json'),'utf8')!==content)throw Error('Stale catalog');}
else fs.writeFileSync(path.join(root,'catalog.json'),content);
