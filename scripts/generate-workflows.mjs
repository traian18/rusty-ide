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
const acceptance=[{type:'criteria',pointer:'/check/criteria'}];
const schema=(name,value)=>({type:'inline',name,schema:value});
const binding=(target,node,pointer='')=>({target,source:node?{type:'node_output',node_id:node,pointer}:{type:'run_input',pointer:`/${target}`}});
const source=(node_id,pointer='')=>({type:'node_output',node_id,pointer});
const retry={max_attempts:2,retry_on:['backend_rate_limited','backend_timeout','tool_timeout','invalid_structured_output']};
// Every agent step is told where it stands in its workflow, what it is given,
// what to do and who reads its result. The role texts below are shared; what
// differs per workflow lives in workflow-catalog-source.json: the
// description, `stages.<id>.instructions` for the preparation steps, and
// `focus.<plan|build|verify|review>` for the steps every editing workflow has.
// Lines of a text; false, null and undefined parts are left out, '' is a blank line.
const lines=(...parts)=>parts.filter(part=>part!==false&&part!=null).join('\n');
const list=items=>items.map((item,i)=>`${i+1}. ${item}`).join('\n');
const inThisWorkflow=focus=>Boolean(focus)&&`\nIn this workflow: ${focus}`;
const PRECEDENCE='Where the notes, the plan and the request disagree, the notes win, then the plan, then the request: the user wrote them in that order, latest first.';
const INPUTS={
 request:'request: the user\'s request, the goal of the whole workflow.',
 context:'context: what came before this run, such as the conversation or the result of an earlier workflow the user continued from (an investigation, a design, a plan). It may be empty. Build on it instead of redoing it, and treat decisions recorded in it as made.',
 research:'research: the Research step\'s findings: sources, options, trade-offs and its recommendation.',
 analyze:'analyze: the Analyze step\'s report on the code: files and symbols, data and control flow, the change surface, the tests and the risks.',
 architect:'architect: the Architect step\'s design: components, interfaces, data flow, failure handling, and the approach it chose and why.',
 debug:'debug: the Debug step\'s diagnosis: the reproduction, the evidence, the root cause and the regression test it proposes.',
 audit:'audit: the security audit\'s findings, each with an id, severity, location, exploit conditions and the remediation it calls for.',
 review:'review: the Review step\'s prioritized findings on the changes.',
 plan:'plan: the plan the user approved: requirements with acceptance criteria and their ids, ordered tasks, and how each criterion is verified.',
 plan_notes:`plan_notes: what the user wrote when approving the plan, in their own words, or empty. The plan was already revised to include it; it is repeated here because it is the user's latest decision. ${PRECEDENCE}`,
 build:'build: the builder\'s report: what changed and where, the checks it ran and their results, what it did differently from the plan, and any changes the user asked for after trying the result.',
 queuedBuild:'build: the tasks that were built, each with the builder\'s report and its per-task review, and the repairs made after them (for a failed verification, or for changes the user asked for after trying the result).',
 verify:'verify: the Verify step\'s report: every criterion with its status and evidence. It passed the acceptance check, so none of them failed.',
};
// A queued builder also gets the queue's own fields.
const QUEUE_INPUTS=[
 'task: the one task you implement now, with the criteria it must satisfy.',
 'requirements: every requirement of the plan with its acceptance criteria.',
 'completed_tasks: the tasks already built and accepted, with what each changed.',
 'previous_attempt: when present, your last attempt at this task and why it was not accepted.',
];
// A preparation step's text from the source: its lead, numbered steps, and a
// closing paragraph about what it must not do and who reads it.
const stageText=text=>{const [lead,...rest]=text.split('\n');return lines(lead,'','What to do',...rest.slice(0,-1),'',rest.at(-1));};
const NOT_PASSED_ON='Only your final message is passed on: the steps after you do not see your exploration or tool calls, so put everything they need in it.';
const planSteps=queued=>[
 'Read the request, the context and the results of the steps before you. Treat decisions recorded there as made.',
 'Read the code the change touches, so every task names real files, symbols and commands rather than guesses.',
 `Write the requirements: what must be true when the work is done. Give each one acceptance criteria that someone who was not here can check (a behavior, an output, a test that passes), including the edge and failure cases that matter.${queued?'':' Number them (R1, R2, ...) and their criteria (R1.1, R1.2, ...) so they can be reported on by id.'}`,
 queued
  ?'Write small, ordered tasks that each change the workspace and leave it working. A fresh builder implements each task seeing only that task, the requirements and the tasks already done, and a reviewer then checks it against the criteria it names. So each task\'s instructions must stand on their own: the files and symbols, what to change, the pattern to follow and what done looks like. List the requirement_ids and criterion_ids each task satisfies; every criterion belongs to a task. Set status to ready.'
  :'Write ordered tasks that change the workspace, each naming the files and symbols, what to change, the pattern to follow and the criteria it satisfies. Every criterion is covered by a task.',
 'Say how each criterion will be verified: the tests to run or add, the commands, and the checks only a person can do (a device, a real service, a visual result).',
 'Put the decisions and assumptions the user should confirm, and the main risks, where they are easy to find. Work only someone outside the workspace can do (rotating credentials, deploying, changing external systems) goes in the summary as follow-ups for the user, not as tasks.',
];
const planText=({focus,queued})=>lines(
 queued?'Write the plan as requirements with acceptance criteria and small ordered tasks, which are built one at a time once the user approves it.':'Write the plan the user approves before anything is built.',
 '','What to do',list(planSteps(queued)),inThisWorkflow(focus),
 '','What happens to your plan',
 'The user reads it next. They approve it, approve it with notes, or ask for changes; notes and changes come back to you to revise the plan. The approved plan is then implemented as written, and Verify checks the workspace against every acceptance criterion: a failed criterion sends the work back to the builder. So keep the criteria specific and checkable, and keep the plan easy to review.',
 'When you revise, change exactly what the user asked for, keep everything else (ids included), and say at the top what changed.',
 'Do not change any files.',
);
// The last step of a stage workflow (Architect & plan, Debug & plan a fix, ...).
const stagePlanText=({focus})=>lines(
 'Write the implementation plan; it is this workflow\'s result.',
 '','What to do',list(planSteps(false)),inThisWorkflow(focus),
 '','What happens to your plan',
 'It goes to the user as this workflow\'s result. They may continue with Build & verify, which adopts it as its plan, asks them to approve it, implements it and checks every acceptance criterion. So keep the criteria specific, checkable and numbered, and make every task concrete enough to build without your exploration.',
 'Do not change any files.',
);
const buildText=({focus})=>lines(
 'Implement the approved plan in the workspace.',
 '','What to do',
 list([
  'Read the plan and plan_notes first, and follow them in the order of precedence above.',
  'Read the code before changing it. Work through the tasks in order and follow the patterns the plan names. Keep to what the plan needs: no unrelated refactors or extras.',
  'Add or update the tests the plan calls for.',
  'Run the project\'s checks (run_check for tests, type check, lint and build when you have it). When one fails, read the output, fix what your change broke and run it again. If a check cannot run here (a missing tool, no network), say so and give the command for the user to run.',
  'Where the code contradicts the plan (a file moved, an API differs), do the smallest thing that meets the requirement and say what you did differently and why.',
  'Do not stop with the work half done because a command failed: make every change the plan needs first.',
 ]),
 inThisWorkflow(focus),
 '','When the work comes back to you',
 '- After a failed verification or final review, the rejection lists each failed criterion with its evidence. That is your repair checklist: fix each one in the code, rerun the relevant checks, and say how each is now met. Criteria left for manual checks are for the user; do not change code for them.',
 '- After the user tried the result and asked for changes, make those changes, keep everything else as it is, and list them in your report under the heading "Changes you asked for" so Verify checks them too.',
 '','What happens next',
 'Verify checks the workspace against every acceptance criterion itself: your report is not evidence, it tells Verify where to look. So report, task by task, what you changed and in which files, the tests you added, each check you ran with its result, what you did differently from the plan and why, and what is left for the user.',
);
const queueBuildText=({focus})=>lines(
 'Implement one task of the approved plan. The task queue hands out the plan\'s tasks one at a time, each to a fresh builder.',
 '','What to do',
 list([
  'Read your task, the criteria it names, and plan_notes, and follow them in the order of precedence above.',
  'Look at completed_tasks so your change fits what is already there; do not undo or redo their work.',
  'Read the code before changing it, make the change your task describes, and add the tests it calls for. Stay within your task.',
  'Run focused checks for what you changed (run_check, with a test name or file when that is enough). Fix what your change broke.',
  'On a retry, address every point in previous_attempt first.',
  'The task final-repair comes after the planned tasks: it fixes what the final verification found, or makes the changes the user asked for after trying the result. Its instructions say which; make those changes and keep everything else.',
 ]),
 inThisWorkflow(focus),
 '','What happens next',
 'A reviewer reads the code you changed and checks each criterion your task names, so in your summary say for each of them how it is met and where (file and line), and list the files you changed and the checks you ran. After the last task, Verify checks the whole plan against the workspace.',
);
const taskReviewText=({workflow,focus})=>lines(
 'Review the change made for workflow_input.task against its acceptance criteria in workflow_input.requirements. Do not edit anything.',
 `This is the per-task review of "${workflow.name}": each task is built by a fresh builder and checked here before the next one starts; after the last task, Verify checks the whole plan.`,
 list([
  'Read the code the builder changed (its summary names the files) and enough of the code around it to judge the change. The summary tells you where to look; it is not evidence.',
  'For each criterion the task names, give evidence from the workspace: file and line, and what there implements it.',
  'Check that the change does not break completed tasks or nearby code, and that it follows the notes the user gave when approving the plan (workflow_input.plan_notes), which take precedence over the plan.',
  'Use status complete only when every named criterion is implemented. Otherwise use needs_repair and say exactly what is missing or wrong and where, so the builder can fix it in one more attempt.',
  'The task final-repair names no criteria: check that it does what its instructions ask.',
 ]),
 Boolean(focus)&&`The builder in this workflow was told: ${focus} Check that too.`,
);
const criteriaRule='Report every requirement and every problem you find as a criterion: pass when it is done properly, fail followed by what is wrong. Use manual only for what cannot be checked here (it needs a person, a device, an external service, or a command that cannot run in this environment), and read the code for it first: a problem found by reading is fail. For a manual criterion, how_to_test gives the user the exact steps or command; leave it empty otherwise.';
const verifyText=({focus,queued,next})=>lines(
 'Check that the work in the workspace does what the approved plan says, and that it was done properly.',
 '','What to do',
 list([
  `Collect what must be true: every acceptance criterion in the plan (${queued?'report them under their ids from workflow_input.plan':'report each under its id'}), every decision in plan_notes, and any changes the user asked for after trying the result (the builder lists them under "Changes you asked for"${queued?' or as repairs':''}). The plan as approved, with the notes, is the target, in the order of precedence above. Something the user removed in their notes is not expected; something they added is.`,
  'Check each one against the workspace yourself: read the code and run the project\'s checks (run_check for tests, type check, lint and build when you have it). The builder\'s report tells you where to look; it is not evidence.',
  'Look beyond the list for problems the change introduced: broken callers, regressions, tests the plan called for that are missing, leftover debug code, unhandled errors, security issues. Report each one as its own criterion.',
  'A check that fails because of this change fails the criteria it touches. A check that was already failing for an unrelated reason fails nothing on its own; say so in the evidence.',
 ]),
 inThisWorkflow(focus),
 '',criteriaRule,
 '','What happens next',
 `An acceptance check reads your criteria. Any fail sends the work back to the builder with your evidence as its repair checklist, so make evidence specific: file and line, the command and its output, what is missing. Manual criteria go to the user to try by hand. ${next?`When everything passes, ${next} reads your report.`:'Your summary is the workflow\'s final result: say what was built, the outcome for each requirement, what the user must check by hand, and the follow-ups from the plan.'}`,
);
const FINAL_RESULT='An acceptance check reads your criteria: a fail sends the work back to the builder with your findings, and the work then goes through Verify and this step again. Your summary is the workflow\'s final result: what was built, the outcome of verification and of this step, what the user must check by hand, and any follow-ups.';
const finalReviewText=({focus})=>lines(
 'Review the finished change as a whole before it goes to the user.',
 '','What to do',
 list([
  'Verify has already checked every acceptance criterion, and its report is in verify; do not redo that. Read the changed code (the builder\'s report names the files) and the code around it.',
  'Look for correctness problems and missed edge cases, regressions for existing callers, design and maintainability problems, inconsistency with the codebase\'s conventions, weak or missing tests, and anything that goes against plan_notes.',
  'Report each real problem as a criterion with status fail and evidence: file and line, what is wrong, and the fix. Report what you checked and found sound as pass. Style preferences that do not affect correctness or maintainability are not failures; mention them in the summary.',
  'Do not repeat Verify\'s manual checks; the user is given those already. Add a manual criterion only for something new that only a person can check.',
 ]),
 inThisWorkflow(focus),
 '',criteriaRule,
 '','What happens next',FINAL_RESULT,
);
const recheckText=({focus})=>lines(
 'Confirm that every finding of the security audit is really fixed, and that the fixes added no new problem.',
 '','What to do',
 list([
  'Take each finding in audit by its id. Read the fixed code and confirm the exploit condition is gone; where a test was added, read it and confirm it exercises the exploit.',
  'Look for bypasses: other call sites or inputs with the same problem, and partial fixes.',
  'Check that the fixes introduced no new risk: weakened validation or authorization, secrets in logs or errors, broader permissions, unsafe defaults.',
  'Report one criterion per finding, under its id: pass when it is fixed, fail with what is still exploitable and where. A finding that needs action outside the workspace (rotating a secret, deploying) is manual, with the exact steps for the user. Do not repeat Verify\'s manual checks.',
 ]),
 inThisWorkflow(focus),
 '',criteriaRule,
 '','What happens next',FINAL_RESULT,
);
// The user approves the plan before anything is built, and confirms at the
// end the checks only a person can do. Notes given with the plan approval
// revise the plan (`revise_on_notes`), so the builder, Verify and the gates all
// work from the plan as approved; requested changes at the end go back to the
// builder.
const planApprovalPrompt='Read the plan before anything is built. Approve it to start building. To change something, write it in the notes: Approve with notes revises the plan to include them and then builds without asking again; Request changes revises it and shows it to you again first. The build and its verification both work from the plan as you approved it.';
const manualChecksPrompt='Verification passed, but these checks need a person. Try each one as described, then Approve. If something does not work, describe what you saw and choose Request changes: the work goes back to the builder with your description and is verified again.';
const reviewChecksPrompt=step=>`${step} found more checks only a person can do. Try each one, then Approve; or describe what does not work and choose Request changes to send the work back to the builder.`;
// Multi-step changes run the approved plan as a task queue: one fresh builder
// and a read-only review per task, each accepted task checkpointed. The plan
// is the typed task plan (`rusty.task_plan`) the queue reads.
const QUEUED=new Set(['researched-feature','careful-change','security-remediation','refactor']);
const taskPlanSchema={type:'registry',schema_id:'rusty.task_plan',revision:1};
const WRITER_NAMES={build:'Build',refactor:'Refactor',optimize:'Optimize',document:'Document'};
const catalog=[
 ['plan-build-verify',[], 'build'],['investigate',['research','analyze']],['design',['architect','plan']],['diagnose',['debug','plan']],['implement',[],'build'],['security-audit',['audit','plan']],['check-changes',['review','verify']],['analyzed-feature',['analyze'],'build'],['researched-feature',['research','architect'],'build'],['bug-fix',['debug'],'build'],['careful-change',['analyze'],'build','review'],['security-remediation',['audit'],'build','recheck'],['refactor',['analyze'],'refactor','review'],['optimize-performance',['analyze'],'optimize'],['documentation',['analyze'],'document','review'],
];
const definitions=JSON.parse(fs.readFileSync(new URL('./workflow-catalog-source.json',import.meta.url),'utf8'));
const outputs=[];
for(const [id,preps,writer,post] of catalog){
 const {stages,focus={},description,...old}=definitions[id];
 const queued=QUEUED.has(id);
 const workflow={...old,revision:old.revision+(writer?5:3),nodes:[],edges:[],
  // stall_timeout_ms: no sign of life from a step for 10 min cancels the attempt and retries it (waiting on a permission prompt does not count).
  policies:{max_total_attempts:40,stall_timeout_ms:600000}};
 const nodes=workflow.nodes;
 const add=n=>{n.metadata={editor:{position:{x:60+nodes.length*440,y:80}}};nodes.push(n);return n;};
 const node=(id,name,type,config,bindings=[],output=null,r={max_attempts:1,retry_on:[]})=>add({id,name,type,config,input_bindings:bindings,output_schema:output,retry:r});
 node('input','Request','input',{defaults:{attachments:[],context:''}});
 const history=[];
 const inputs=()=>[binding('request'),binding('context'),...history.map(id=>binding(id,id))];
 // The steps after plan approval also read the user's notes, right after the plan.
 const withNotes=bindings=>{bindings.splice(bindings.findIndex(b=>b.target==='plan')+1,0,binding('plan_notes','approve_plan','/notes'));return bindings;};
 const gate=(id,producer,checks,repair)=>node(id,'Acceptance','verify',{checks,...(repair?{retry_target:repair}:{})},[binding('check',producer),...(history.includes('plan')?[binding('plan','plan')]:[])]);
 // Ordinary steps exchange complete prose. Only acceptance reviewers need a
 // machine-readable verdict; successful execution already controls sequencing.
 // Instructions are written once the whole pipeline is known.
 const texts=new Map();
 const addAgent=(id,name,profile,text,output=null,bindings=inputs(),extra={})=>{
  texts.set(node(id,name,'agent',{instructions:'',tools:{type:'inherit'},context_mode:'isolated_child',structured_output:output?'host_validated':'text',profile:{id:profile},...extra},bindings,schema(id,output??{type:'string'}),retry),text);
  history.push(id);
 };
 const labels=new Map();
 for(const prep of preps){
  if(prep==='plan')addAgent('plan','Plan','plan',stagePlanText);
  else addAgent(prep,stages[prep].name,stages[prep].profile,()=>stageText(stages[prep].instructions));
 }
 if(writer){
  addAgent('plan','Plan','plan',planText,queued?{type:'object'}:null);
  if(queued)nodes.find(n=>n.id==='plan').output_schema=taskPlanSchema;
  labels.set(node('approve_plan','Plan approval','approval',{subject:source('plan'),prompt:planApprovalPrompt,revise_on_notes:true}),'you approve the plan');
  const name=WRITER_NAMES[writer];
  if(queued)addAgent('build',name,writer,queueBuildText,{type:'object'},withNotes(inputs()),{task_queue:{plan_pointer:'/plan',review_profile:{id:'review'},review_instructions:taskReviewText({workflow,focus:focus.build}),max_repairs:2,on_task_failure:'ask'}});
  else addAgent('build',name,writer,buildText,null,withNotes(inputs()));
  addAgent('verify','Verify','verify',verifyText,reviewSchema,withNotes(inputs()));
  // A queued plan's acceptance criteria must all be reported on, not just the ones the reviewer chose to mention.
  gate('gate','verify',queued?[{type:'criteria',pointer:'/check/criteria',plan_pointer:'/plan'}]:acceptance);
  const postName=post==='recheck'?'Security acceptance':'Final review';
  if(post){
   addAgent(post,postName,post==='recheck'?'security':'review',post==='recheck'?recheckText:finalReviewText,reviewSchema,withNotes(inputs()));
   gate(`${post}_gate`,post,acceptance);
  }
  labels.set(node('confirm_checks','Manual checks','approval',{subject:source('gate','/manual_checks'),prompt:manualChecksPrompt,revise_target:'build',skip_if_empty:''}),'you try the manual checks');
  // What only a person can check in the final review is asked separately,
  // and only when there is something to ask.
  if(post)labels.set(node('confirm_review_checks',`${postName} checks`,'approval',{subject:source(`${post}_gate`,'/manual_checks'),prompt:reviewChecksPrompt(postName),revise_target:'build',skip_if_empty:''}),`you try the manual checks from the ${postName.toLowerCase()}`);
 }
 if(writer){
  const build=nodes.find(n=>n.id==='build');
  build.retry={max_attempts:3,retry_on:['backend_rate_limited','backend_timeout','tool_timeout','verification_failed']};
  for(const id of ['gate',...(post?[`${post}_gate`]:[])])nodes.find(n=>n.id===id).config.retry_target='build';
 }
 // Every step learns where it stands, what it is given and who reads its result.
 const steps=nodes.slice(1);
 const pipeline=steps.map(n=>n.type==='agent'?n.name:n.type==='verify'?'acceptance check':labels.get(n)).join(' → ');
 const agents=nodes.filter(n=>n.type==='agent');
 for(const [n,text] of texts){
  const later=agents.slice(agents.indexOf(n)+1);
  const [purpose,...body]=text({workflow,focus:focus[n.id],queued,next:later[0]?.name}).split('\n');
  while(body[0]==='')body.shift();
  const given=n.input_bindings.map(b=>INPUTS[b.target==='build'&&queued?'queuedBuild':b.target]);
  if(n.config.task_queue)given.push(...QUEUE_INPUTS);
  n.config.instructions=lines(
   purpose,
   '','Your place in the workflow',
   `"${workflow.name}" runs: ${pipeline}. You are ${n.name}, step ${steps.indexOf(n)+1} of ${steps.length}.`,
   '','What you are given (in workflow_input)',
   ...given.map(item=>`- ${item}`),
   '',...body,
   later.length>0&&`\n${NOT_PASSED_ON}`,
  );
 }
 const last=history.at(-1);const lastAgent=nodes.find(n=>n.id===last);const pointer=lastAgent.config.structured_output==='text'?'':'/summary';
 node('output','Result','output',{source:source(last,pointer),strict:false});
 workflow.output_contract={schema:schema('result',{type:'string'}),source:source(last,pointer),strict:false};
 workflow.edges=nodes.slice(0,-1).map((n,i)=>({id:`${n.id}-${nodes[i+1].id}`,source:n.id,target:nodes[i+1].id,condition:'on_success'}));
 workflow.metadata={...workflow.metadata,orchestration:'task-queue-v1'};
 workflow.description=description;
 const file=id==='plan-build-verify'?'plan-build-verify.workflow.json':`workflows/${id}.workflow.json`;
 outputs.push([file,workflow]);
}
const manifest={profiles:['research','analyze','plan','build','verify','review','debug','architect','security','document','refactor','optimize'].map(id=>read(`${id}.profile.json`)),workflows:outputs.map(([,d])=>d)};
const content=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(path.join(root,'catalog.json'),'utf8')!==content)throw Error('Stale catalog');}
else fs.writeFileSync(path.join(root,'catalog.json'),content);
