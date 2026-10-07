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
// Acceptance is judged criterion by criterion, never from a free-text verdict:
// fail goes back to Build, manual (only a person can check it) moves on and is
// listed for the user. how_to_test is empty unless the criterion is manual.
const reviewSchema=object({criteria:array(object({id:string,status:{type:'string',enum:['pass','fail','manual']},evidence:string,how_to_test:{type:'string'}})),summary:string});
const criteriaRule='Report every requirement and every problem you find as a criterion: pass when it is done properly, fail followed by what is wrong. Use manual only for what cannot be checked here (it needs a person, a device, an external service, or a command that cannot run in this environment), and read the code for it first: a problem found by reading is fail. For a manual criterion, how_to_test gives the user the exact steps or command; leave it empty otherwise.';
const acceptance=[{type:'criteria',pointer:'/check/criteria'}];
const schema=(name,value)=>({type:'inline',name,schema:value});
const binding=(target,node,pointer='')=>({target,source:node?{type:'node_output',node_id:node,pointer}:{type:'run_input',pointer:`/${target}`}});
const source=(node_id,pointer='')=>({type:'node_output',node_id,pointer});
const retry={max_attempts:2,retry_on:['backend_rate_limited','backend_timeout','tool_timeout','invalid_structured_output']};
const contextRule='Start from workflow_input.request.';
const reportRule='Finish with a clear summary.';
const planInstructions='Plan the request. Write the requirements with acceptance criteria, and ordered tasks that change the code. Every task must change the workspace; things only someone outside it can do (credential rotation, deployments, history rewrites) go in the summary as follow-ups for the user.';
// The user approves the plan before anything is built, and confirms at the
// end the checks only a person can do; both send their notes back to the
// step that has to change.
const planApprovalPrompt='Review the plan before it is built. Approve it, or say what to change and the plan is revised.';
const manualChecksPrompt='These checks could not be done automatically. Try them, then approve; or describe what does not work and the work goes back to Build.';
const builderInstructions='Implement the plan in workflow_input.plan in the workspace, following any notes the user gave when approving it (workflow_input.plan_notes). Read the code, make the changes, and run the project\'s checks when you can. If a command fails, read its output and try another way; do not stop before the changes are made. When Verify or a final review sends the work back, use every failed criterion and its evidence as a repair checklist; criteria left for manual checks are for the user, so do not change code for them. Inspect the named files, implement the missing behavior, then rerun focused checks and verify each criterion against the actual workspace. Finish with a short summary of what you changed.';
// Multi-step changes run the approved plan as a task queue: one fresh builder
// and a read-only review per task, each accepted task checkpointed. The plan
// is the typed task plan (`rusty.task_plan`) the queue reads.
const QUEUED=new Set(['researched-feature','careful-change','security-remediation','refactor']);
const taskPlanSchema={type:'registry',schema_id:'rusty.task_plan',revision:1};
const queuePlanInstructions='Plan the request as requirements, each with observable acceptance criteria, and small ordered tasks that each change the workspace and name the criteria they satisfy; set status to ready. Things only someone outside the workspace can do (credential rotation, deployments, history rewrites) go in the summary as follow-ups for the user.';
const queueBuilderInstructions='You implement one task of the approved plan. Follow any notes the user gave when approving it (workflow_input.plan_notes). Read the code before changing it, make the changes, and run focused checks when you can.';
const taskReviewInstructions='Review the change made for workflow_input.task against its acceptance criteria in workflow_input.requirements. Read the changed code; do not edit. For each criterion the task names give evidence from the workspace (file and line). Use status complete only when every one of them is implemented; otherwise needs_repair with what is missing.';
const verifyInstructions=`Check that the changes in the workspace implement workflow_input.request and the plan, and that they were done properly. Run the project\'s checks when you can. ${criteriaRule}`;
const catalog=[
 ['plan-build-verify',[], 'build'],['investigate',['research','analyze']],['design',['architect','plan']],['diagnose',['debug','plan']],['implement',[],'build'],['security-audit',['audit','plan']],['check-changes',['review','verify']],['analyzed-feature',['analyze'],'build'],['researched-feature',['research','architect'],'build'],['bug-fix',['debug'],'build'],['careful-change',['analyze'],'build','review'],['security-remediation',['audit'],'build','recheck'],['refactor',['analyze'],'refactor','review'],['optimize-performance',['analyze'],'optimize'],['documentation',['analyze'],'document','review'],
];
const definitions=JSON.parse(fs.readFileSync(new URL('./workflow-catalog-source.json',import.meta.url),'utf8'));
const outputs=[];
for(const [id,preps,writer,post] of catalog){
 const {stages,...old}=definitions[id];
 const workflow={...old,revision:old.revision+(writer?4:2),nodes:[],edges:[],
  // stall_timeout_ms: no sign of life from a step for 10 min cancels the attempt and retries it (waiting on a permission prompt does not count).
  policies:{max_total_attempts:40,stall_timeout_ms:600000}};
 const nodes=workflow.nodes;
 const add=n=>{n.metadata={editor:{position:{x:60+nodes.length*440,y:80}}};nodes.push(n);return n;};
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
  const queued=QUEUED.has(id);
  addAgent('plan','Plan','plan',queued?queuePlanInstructions:planInstructions,queued?{type:'object'}:null);
  if(queued)nodes.find(n=>n.id==='plan').output_schema=taskPlanSchema;
  node('approve_plan','Plan approval','approval',{subject:source('plan'),prompt:planApprovalPrompt});
  const buildBindings=[...inputs(),binding('plan_notes','approve_plan','/notes')];
  if(queued)addAgent('build','Build',writer,queueBuilderInstructions,{type:'object'},buildBindings,{task_queue:{plan_pointer:'/plan',review_profile:{id:'review'},review_instructions:taskReviewInstructions,max_repairs:2,on_task_failure:'ask'}});
  else addAgent('build','Build',writer,builderInstructions,null,buildBindings);
  addAgent('verify','Verify','verify',queued?`${verifyInstructions} Report the plan's acceptance criteria under their ids from workflow_input.plan.`:verifyInstructions,reviewSchema);
  // A queued plan's acceptance criteria must all be reported on, not just the ones the reviewer chose to mention.
  gate('gate','verify',queued?[{type:'criteria',pointer:'/check/criteria',plan_pointer:'/plan'}]:acceptance);
  if(post){
   const purpose=post==='recheck'?`Check that each original finding in workflow_input.audit is actually fixed and that the fixes add no new problem. ${criteriaRule}`:`Review the changes in the workspace for correctness and regressions. ${criteriaRule}`;
   addAgent(post,post==='recheck'?'Security acceptance':'Final review',post==='recheck'?'security':'review',purpose,reviewSchema);
   gate(`${post}_gate`,post,acceptance);
  }
  node('confirm_checks','Manual checks','approval',{subject:source('gate','/manual_checks'),prompt:manualChecksPrompt,revise_target:'build',skip_if_empty:''});
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
 workflow.description=writer?'Plan the change and let you approve it, implement it in the workspace, then verify it was done properly. A failed verification sends the work back with the findings; checks only a person can do are given to you to confirm.':`${old.name}: inspect the requested scope with preserved conversation context. Findings and unknowns remain visible in the final report.`;
 const file=id==='plan-build-verify'?'plan-build-verify.workflow.json':`workflows/${id}.workflow.json`;
 outputs.push([file,workflow]);
}
const manifest={profiles:['research','analyze','plan','build','verify','review','debug','architect','security','document','refactor','optimize'].map(id=>read(`${id}.profile.json`)),workflows:outputs.map(([,d])=>d)};
const content=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(path.join(root,'catalog.json'),'utf8')!==content)throw Error('Stale catalog');}
else fs.writeFileSync(path.join(root,'catalog.json'),content);
