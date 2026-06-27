import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';
import * as db from './db.js';
import { google } from 'googleapis';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;
if (apiKey && apiKey.trim() !== '' && apiKey.startsWith('AIzaSy')) {
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn('GEMINI_API_KEY is not set or invalid (must start with AIzaSy). Using local rule-based simulation of agent loop.');
}

// Convert local file to Generative Part
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString('base64'),
      mimeType
    },
  };
}

/**
 * Universal Capture: Extracts task, deadline, context from text or screenshot.
 */
export async function parseCapture(inputData) {
  const currentLocalTime = new Date().toLocaleString();
  const systemPrompt = `
You are LastCall's Universal Capture AI engine.
Your job is to parse text messages, email text, WhatsApp messages, Slack snippets, or screenshots, and extract the deadline and task context.
Today's date and time is: ${currentLocalTime}.

You must return a JSON object with the following fields:
{
  "title": "A short, actionable title of the task",
  "deadline": "The deadline date and time formatted in ISO string format (use today's date ${currentLocalTime} to resolve relative deadlines like 'tomorrow', 'next Monday', 'in 4 hours')",
  "priority": "high" | "medium" | "low",
  "description": "A concise description of the task requirements and context",
  "suggestedAction": "What the next immediate step is (e.g. 'Draft an extension request to Professor Smith' or 'Schedule a 2 hour focus session to write the project outline')"
}
`;

  if (!genAI) {
    return mockParseCapture(inputData);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    let contents = [];

    if (inputData.file) {
      const mimeType = inputData.file.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const imagePart = fileToGenerativePart(inputData.file, mimeType);
      contents = [systemPrompt, imagePart, `Please analyze this screenshot and extract the task information.`];
    } else {
      contents = [systemPrompt, `Input Text to Parse: "${inputData.text}"`];
    }

    const result = await model.generateContent({
      contents,
      generationConfig: { responseMimeType: 'application/json' }
    });

    return JSON.parse(result.response.text());
  } catch (err) {
    console.error('Error during Gemini Parse Capture, falling back to mock:', err);
    return mockParseCapture(inputData);
  }
}

function mockParseCapture(inputData) {
  const text = inputData.text || '';
  const now = new Date();
  
  let title = 'New Captured Commitment';
  let deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); 
  let priority = 'medium';
  let description = 'Extracted from capture.';
  let suggestedAction = 'Schedule focus time to complete this.';

  const textLower = text.toLowerCase();
  if (textLower.includes('sentinel') || textLower.includes('project')) {
    title = 'Project Sentinel Submission';
    deadline = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
    priority = 'high';
    description = 'Submit Design Phase III for Project Sentinel.';
    suggestedAction = 'Draft extension request & schedule focus time.';
  } else if (textLower.includes('invoice') || textLower.includes('bill') || textLower.includes('pay')) {
    title = 'Pay Hosting Invoice';
    deadline = new Date(now.getTime() + 28 * 60 * 60 * 1000).toISOString();
    priority = 'high';
    description = 'Server hosting bill is past due.';
    suggestedAction = 'Draft confirmation email & schedule focus block.';
  } else if (textLower.includes('interview') || textLower.includes('schedule') || textLower.includes('hr')) {
    title = 'Schedule Technical Interview';
    deadline = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    priority = 'medium';
    description = 'Final technical interview round booking.';
    suggestedAction = 'Draft calendar response to HR.';
  } else if (text) {
    title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
    description = text;
  }

  return { title, deadline, priority, description, suggestedAction };
}

/* ==========================================================================
   GEMINI TOOL SCHEMAS & IMPLEMENTATIONS
   ========================================================================== */

const toolDeclarations = [
  {
    name: 'read_calendar_events',
    description: 'Read the user\'s Google Calendar events to find existing appointments (busy blocks) for the next 7 days.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'scan_gmail_for_deadlines',
    description: 'Scan recent unread email subjects and snippets for potential commitments or deadlines.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'create_calendar_block',
    description: 'Reserve a focus time block on the user\'s Calendar and persist in the local database for a specific task.',
    parameters: {
      type: 'OBJECT',
      properties: {
        taskId: { type: 'STRING', description: 'The ID of the task.' },
        title: { type: 'STRING', description: 'Summary of focus time block (e.g. Focus Time: Design Outline).' },
        start: { type: 'STRING', description: 'ISO start date/time (e.g. 2026-06-27T10:00:00Z).' },
        end: { type: 'STRING', description: 'ISO end date/time (e.g. 2026-06-27T12:00:00Z).' }
      },
      required: ['taskId', 'title', 'start', 'end']
    }
  },
  {
    name: 'draft_email',
    description: 'Draft a professional communication (e.g. request for extension) and hold it in the human approval queue.',
    parameters: {
      type: 'OBJECT',
      properties: {
        taskId: { type: 'STRING', description: 'The ID of the task.' },
        to: { type: 'STRING', description: 'Recipient email address.' },
        subject: { type: 'STRING', description: 'Email subject lines.' },
        body: { type: 'STRING', description: 'The draft email body text.' },
        reason: { type: 'STRING', description: 'Briefly explain why this draft is needed.' }
      },
      required: ['taskId', 'to', 'subject', 'body', 'reason']
    }
  }
];

// Helper to run Google APIs or mock methods depending on auth status
async function handleToolCall(name, args, oauthClient) {
  console.log(`[AGENT EXECUTE TOOL]: ${name}`, args);

  switch (name) {
    case 'read_calendar_events': {
      if (oauthClient) {
        try {
          const calendar = google.calendar({ version: 'v3', auth: oauthClient });
          const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date().toISOString(),
            timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            singleEvents: true,
            orderBy: 'startTime'
          });
          return {
            events: (res.data.items || []).map(e => ({
              id: e.id,
              title: e.summary,
              start: e.start.dateTime || e.start.date,
              end: e.end.dateTime || e.end.date
            }))
          };
        } catch (err) {
          console.error('Google Calendar API error in tool:', err.message);
        }
      }
      return { events: getMockCalendarEvents() };
    }

    case 'scan_gmail_for_deadlines': {
      if (oauthClient) {
        try {
          const gmail = google.gmail({ version: 'v1', auth: oauthClient });
          const res = await gmail.users.messages.list({
            userId: 'me',
            q: 'subject:(due OR deadline OR submit OR "action required") OR "due by" OR "respond by"',
            maxResults: 5
          });
          const unreadEmails = [];
          if (res.data.messages) {
            for (const msg of res.data.messages) {
              const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id });
              const headers = detail.data.payload.headers;
              const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
              const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
              unreadEmails.push({ id: msg.id, from, subject, snippet: detail.data.snippet || '' });
            }
          }
          return { emails: unreadEmails };
        } catch (err) {
          console.error('Gmail API error in tool:', err.message);
        }
      }
      return { emails: getMockGmailEmails() };
    }

    case 'create_calendar_block': {
      const activeBlocks = db.getCalendarBlocks();
      const duplicate = activeBlocks.find(b => b.taskId === args.taskId && b.start === args.start);
      if (duplicate) {
        return { success: false, reason: 'Duplicate block exists', blockId: duplicate.id };
      }

      const newLocalBlock = db.addCalendarBlock({
        taskId: args.taskId,
        title: args.title,
        start: args.start,
        end: args.end
      });

      let googleEventId = null;
      if (oauthClient) {
        try {
          const calendar = google.calendar({ version: 'v3', auth: oauthClient });
          const gEvent = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary: args.title,
              description: 'Scheduled by LastCall Sentinel.',
              start: { dateTime: args.start },
              end: { dateTime: args.end }
            }
          });
          googleEventId = gEvent.data.id;
          db.clearCalendarBlocksForTask(args.taskId);
          db.addCalendarBlock({
            taskId: args.taskId,
            title: args.title,
            start: args.start,
            end: args.end,
            id: googleEventId,
            googleEventId
          });
        } catch (err) {
          console.error('Failed to create calendar event on Google:', err.message);
        }
      }

      db.addActivityLog({
        type: 'focus_block_created',
        description: `Reserved Focus Block: "${args.title}"`,
        details: `Time: ${new Date(args.start).toLocaleString()} - ${new Date(args.end).toLocaleTimeString()}`,
        status: 'done',
        action: {
          taskId: args.taskId,
          blockId: googleEventId || newLocalBlock.id,
          isLive: !!googleEventId
        }
      });

      return { success: true, blockId: googleEventId || newLocalBlock.id };
    }

    case 'draft_email': {
      const currentLogs = db.getActivityLog();
      const duplicate = currentLogs.find(
        l => l.type === 'email_draft_created' && 
        l.status === 'awaiting_approval' && 
        l.action && l.action.taskId === args.taskId
      );

      if (duplicate) {
        return { success: false, reason: 'Active draft already exists for this task.' };
      }

      const newLog = db.addActivityLog({
        type: 'email_draft_created',
        description: `Drafted Email: "${args.subject}"`,
        details: `To: ${args.to}\n\n${args.body}`,
        status: 'awaiting_approval',
        action: {
          taskId: args.taskId,
          to: args.to,
          subject: args.subject,
          body: args.body,
          reason: args.reason
        }
      });

      return { success: true, logId: newLog.id };
    }

    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

/* ==========================================================================
   REAL MULTI-TURN AI AGENT LOOP
   ========================================================================== */

export async function runPlannerLoop(oauthClient = null) {
  const currentLocalTime = new Date().toISOString();
  const tasks = db.getTasks().filter(t => t.status === 'pending');

  if (tasks.length === 0) {
    const emptyPlan = {
      primaryRecommendation: null,
      riskScore: 0,
      reasoningSteps: ['No active tasks in database. Sentinel idle.'],
      suggestedFocusBlocks: [],
      suggestedEmails: []
    };
    db.setLatestPlan(emptyPlan);
    return emptyPlan;
  }

  const initialPrompt = `
You are the planner engine of "LastCall" - a proactive AI agent that scans calendar status and drafts emails on the user's behalf.
Current local time is: ${currentLocalTime}.

Active Tasks:
${JSON.stringify(tasks, null, 2)}

Instructions:
1. Scan the user's calendar events using 'read_calendar_events' to see their busy times.
2. Scan unread emails using 'scan_gmail_for_deadlines' to inspect potential new commitments.
3. For any at-risk tasks, resolve conflicts by scheduling focus blocks (using 'create_calendar_block') in free times slots, or drafting extension request emails (using 'draft_email') if time is short.
4. Call tools as needed. Execute tools in multiple turns if necessary.
5. Once your queries and allocations are finalized, compile the global planning output.

Your final output response must be a JSON object with:
{
  "primaryRecommendation": {
    "taskId": "ID of task (or null if none)",
    "title": "Action title (e.g. 'Draft extension for Project Sentinel')",
    "reason": "Why this recommendation is given",
    "effortMinutes": 45,
    "urgency": "Critical" | "High" | "Medium" | "Low"
  },
  "riskScore": 75, // integer 0 to 100
  "reasoningSteps": [
    "Step 1 (e.g. 'Executed read_calendar_events')",
    "Step 2 (e.g. 'Detected Sentinel Phase III due in 4 hours')"
  ]
}
`;

  if (!genAI) {
    return runSimulatedPlanner(tasks, currentLocalTime);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      tools: [{ functionDeclarations: toolDeclarations }]
    });

    const chatHistory = [
      { role: 'user', parts: [{ text: initialPrompt }] }
    ];

    let loopCount = 0;
    const maxLoops = 6;

    while (loopCount < maxLoops) {
      loopCount++;
      const result = await model.generateContent({
        contents: chatHistory
      });

      const candidate = result.response.candidates?.[0];
      const functionCalls = candidate?.content?.parts?.filter(p => p.functionCall);
      const normalTextPart = candidate?.content?.parts?.find(p => p.text);

      if (functionCalls && functionCalls.length > 0) {
        // Prepare function responses
        const functionResponseParts = [];

        // Save the assistant content with the function calls to history
        chatHistory.push(candidate.content);

        for (const part of functionCalls) {
          const call = part.functionCall;
          const toolResult = await handleToolCall(call.name, call.args, oauthClient);

          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: toolResult }
            }
          });
        }

        // Save the execution results back to history
        chatHistory.push({
          role: 'user',
          parts: functionResponseParts
        });
      } else if (normalTextPart && normalTextPart.text) {
        // Final response received
        const text = normalTextPart.text;
        
        // Clean JSON syntax if returned with markdown wrapper
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const plan = JSON.parse(jsonMatch[0]);
          db.setLatestPlan(plan);
          return plan;
        }
        const plan = JSON.parse(text);
        db.setLatestPlan(plan);
        return plan;
      } else {
        // Fallback exit
        break;
      }
    }

    throw new Error('Agent execution loop limit reached without response');
  } catch (err) {
    console.error('Real Gemini Agent Loop failed, falling back to simulator:', err);
    const plan = await runSimulatedPlanner(tasks, currentLocalTime);
    db.setLatestPlan(plan);
    return plan;
  }
}

/**
 * Local simulator version of the perceive-plan-act loop when Gemini is missing.
 */
async function runSimulatedPlanner(tasks, currentLocalTime) {
  const now = new Date();
  const sorted = [...tasks].sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const topTask = sorted[0];
  const hoursLeft = Math.max(0, Math.floor((new Date(topTask.deadline) - now) / (1000 * 60 * 60)));

  // Simulate tool calls
  console.log('[AGENT SIMULATOR] Executing read_calendar_events...');
  const calendarData = getMockCalendarEvents();

  console.log('[AGENT SIMULATOR] Executing scan_gmail_for_deadlines...');
  const emailData = getMockGmailEmails();

  const isUrgent = topTask.priority === 'high' && hoursLeft < 12;
  const riskScore = isUrgent ? 85 : 40;

  const reasoningSteps = [
    `1. Perceive: Read local task list. Target task: "${topTask.title}".`,
    `2. Execute: read_calendar_events. Located conflicts in next 24h.`,
    `3. Execute: scan_gmail_for_deadlines. Inbox evaluated.`,
    isUrgent 
      ? `4. Execute: draft_email. Ingesting request draft in approval feed.`
      : `4. Execute: create_calendar_block. Registering event in local scheduler.`
  ];

  if (isUrgent) {
    // Simulate draft_email tool call
    await handleToolCall('draft_email', {
      taskId: topTask.id,
      to: 'lead-designer@company.com',
      subject: `Extension Request: ${topTask.title}`,
      body: `Hi Team,\n\nI am requesting a 24-hour extension on "${topTask.title}" which is due on ${new Date(topTask.deadline).toLocaleString()}.\n\nLastCall AI Agent has checked my calendar and noted conflicts in the remaining time. I will deliver the finalized draft once focus periods resolve.\n\nBest,\nSaksham\n(Drafted by LastCall AI)`,
      reason: 'Urgent deadline due soon with conflicting meetings.'
    }, null);
  } else {
    // Simulate create_calendar_block tool call
    const startOffset = now.getTime() + 1.5 * 60 * 60 * 1000;
    await handleToolCall('create_calendar_block', {
      taskId: topTask.id,
      title: `Focus Time: ${topTask.title}`,
      start: new Date(startOffset).toISOString(),
      end: new Date(startOffset + 1.5 * 60 * 60 * 1000).toISOString()
    }, null);
  }

  const plan = {
    primaryRecommendation: {
      taskId: topTask.id,
      title: isUrgent ? `Draft extension for ${topTask.title}` : `Schedule Focus Block for ${topTask.title}`,
      reason: `Deadline expires in ${hoursLeft} hours. Focus schedules are highly packed.`,
      effortMinutes: topTask.priority === 'high' ? 90 : 45,
      urgency: hoursLeft < 12 ? 'Critical' : 'High'
    },
    riskScore,
    reasoningSteps
  };
  db.setLatestPlan(plan);
  return plan;
}

// Mock Data Generators
function getMockCalendarEvents() {
  const now = new Date();
  const getDay = (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);

  return [
    {
      id: 'mock_ev_1',
      title: 'Daily Team Standup',
      start: new Date(getDay(0).setHours(10, 0, 0)).toISOString(),
      end: new Date(getDay(0).setHours(10, 30, 0)).toISOString()
    },
    {
      id: 'mock_ev_2',
      title: 'Lunch Break & Walk',
      start: new Date(getDay(0).setHours(13, 0, 0)).toISOString(),
      end: new Date(getDay(0).setHours(14, 0, 0)).toISOString()
    },
    {
      id: 'mock_ev_3',
      title: 'Client Review Sync',
      start: new Date(getDay(0).setHours(15, 0, 0)).toISOString(),
      end: new Date(getDay(0).setHours(16, 0, 0)).toISOString()
    }
  ];
}

function getMockGmailEmails() {
  return [
    {
      id: 'mock_msg_1',
      from: 'prof_gupta@university.edu',
      subject: 'URGENT: Submit Project Sentinel Phase III',
      snippet: 'Submit your Project Sentinel Phase III deliverables by tomorrow morning at 9:00 AM. No late work is accepted.'
    }
  ];
}
