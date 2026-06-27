# Hackathon Project Submission Document — LastCall

> Copy and paste this document directly into your Google Doc/submission form, and customize the live links before submitting!

---

## 1. Problem Statement Selected
**"The Last-Minute Life Saver"**
Students, professionals, and entrepreneurs frequently miss deadlines, assignments, meetings, bill payments, and interviews. Existing productivity tools rely on passive reminders (push notifications, alerts) that are easy to swipe away and ignore. The objective is to build an AI-powered productivity companion that moves beyond simple notifications to proactively assist users in planning, scheduling, and taking concrete steps to resolve deadlines before they are missed.

---

## 2. Solution Overview
**LastCall** is a full-stack AI sentinel agent implementing a complete **Perceive-Plan-Act-Reflect** loop that acts on the user's behalf. 

Instead of warning the user that a task is due, the agent:
1. **Perceives** deadlines by scanning Gmail alerts, Google Calendar free-busy times, and raw text/screenshot uploads via a Universal Capture input.
2. **Plans** a schedule by calling Gemini to locate open calendar slots and schedule non-overlapping focus-time blocks.
3. **Acts** by automatically booking focus time blocks on Google Calendar and drafting appropriate email responses (e.g. extension requests) when deadlines are at risk.
4. **Enforces a Trust Boundary (Human-in-the-Loop)** where all internal calendar adjustments execute autonomously, but any external outbound action (like sending an email) is held in a glowing queue for one-tap human approval before delivery.
5. **Reflects** by periodically scanning the calendar and user check-offs, automatically re-planning when conflicts or modifications arise.

---

## 3. Key Features

- **Universal Ingestion (Multimodal Capture)**: Paste unformatted chat logs, WhatsApp transcripts, forward emails, or drop a screenshot of a dashboard. Gemini extracts critical metadata: task name, resolved absolute deadlines, priority, and description notes.
- **Gemini Scheduling Engine**: Analyzes task complexity and cross-references it with calendar availability. It generates focus time blocks in open slots and outputs a transparent logic map showing its step-by-step reasoning.
- **Risk Score Gauge**: Visualizes overall timeline threat on a radial progress bar (0 to 100%), signaling whether the current schedule is safe, elevated, or critical.
- **Agent Activity Log**: A live command center showcasing all decisions. Items waiting for human gate show a pulsing alert, letting users approve and send emails via the Gmail API, or cancel and undo scheduled items with one click.
- **Live Google API Integration / Simulator Toggle**: Implements full integrations with the official Calendar and Gmail endpoints. If keys are missing, the system detects this and falls back to a high-fidelity Simulator Mode, allowing judges to test the agent loop end-to-end immediately.

---

## 4. Technologies Used

- **Frontend**: React (Vite) styled with Vanilla CSS and Tailwind CSS.
- **Shader FX**: WebGL fragment shaders render ambient graphic environments (moving mesh backgrounds and swirling purple-to-blue intelligence orbs) matching premium, futuristic aesthetics.
- **Backend**: Node.js + Express web API server.
- **Authentication**: Google OAuth 2.0 with session storage.
- **File Handling**: Multer for screenshot image uploads.
- **Database**: Local SQLite database using Node.js's native `node:sqlite` DatabaseSync module, storing tasks, calendar focus blocks, agent activity logs, and secure credentials server-side.

---

## 5. Google Technologies Utilized

- **Google AI Studio / Gemini 1.5 Flash**: Orchestrates reasoning, scheduling decisions, and multi-turn function calling / tool use (read_calendar_events, scan_gmail_for_deadlines, create_calendar_block, draft_email), plus multimodal capture analysis.
- **Google Calendar API**: Reads events to detect schedule blocks and inserts focus time reservations autonomously.
- **Gmail API**: Scans inbox messages for deadline context and constructs, drafts, and sends email extension requests.
- **Antigravity AI Agent**: Used as the primary pair-programming agent to design, scaffold, write, and verify the backend, frontend, database, and logic loop.
