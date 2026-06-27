import { parseCapture, runPlannerLoop } from './agent.js';
import * as db from './db.js';

async function main() {
  console.log('--- STARTING LASTCALL SENTINEL OFFLINE TEST ---');
  
  // 1. Reset database to starting state
  console.log('\n[1] Initializing Database...');
  db.resetAll();
  
  // 2. Test parsing a manual text capture
  console.log('\n[2] Testing Universal Capture Parser...');
  const captureInput = {
    text: 'Prof Gupta says we must submit the design phase of Project Sentinel by tomorrow morning at 9am or fail'
  };
  
  const parsedTask = await parseCapture(captureInput);
  console.log('Parsed Ingestion Output:');
  console.log(JSON.stringify(parsedTask, null, 2));

  // 3. Insert the parsed task
  console.log('\n[3] Ingesting task into DB...');
  const added = db.addTask({
    title: parsedTask.title,
    deadline: parsedTask.deadline,
    priority: parsedTask.priority,
    description: parsedTask.description,
    source: 'screenshot'
  });
  console.log('Saved Task ID:', added.id);

  // 4. Run the full perceive-plan-act loop
  console.log('\n[4] Running Perceive-Plan-Act loop...');
  const plan = await runPlannerLoop(null);
  console.log('AI Planner Plan Result:');
  console.log(JSON.stringify(plan, null, 2));

  // 5. Verify the logs
  console.log('\n[5] Verifying Activity Log updates...');
  const logs = db.getActivityLog();
  console.log(`Current Log Entries (${logs.length}):`);
  logs.forEach(l => {
    console.log(`- [${l.type}] ${l.description} (Status: ${l.status})`);
  });

  console.log('\n--- TEST SUITE COMPLETE ---');
}

main().catch(err => {
  console.error('Test execution failed:', err);
});
