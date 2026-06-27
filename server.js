import express from 'express';
import session from 'express-session';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { google } from 'googleapis';
import * as db from './db.js';
import { parseCapture, runPlannerLoop } from './agent.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure temp_uploads folder exists
const uploadsDir = path.join(process.cwd(), 'temp_uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent directory traversal
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, 'upload_' + Date.now() + '_' + sanitized);
  }
});

// Configure Multer with strict image file types and size limit of 5MB
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    if (ext && mime) {
      return cb(null, true);
    }
    cb(new Error('File upload rejected: Only image files (PNG, JPG, JPEG, WEBP) are allowed.'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Middlewares
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

// Secure session configurations
app.use(session({
  secret: process.env.SESSION_SECRET || 'lastcall-hackathon-super-secret-key-10x',
  resave: false,
  saveUninitialized: false, // Security: do not save uninitialized session
  cookie: {
    httpOnly: true, // Prevents client-side scripts from reading cookie
    secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in production
    sameSite: 'lax', // Protect against CSRF
    maxAge: 24 * 60 * 60 * 1000 // 24 hours session expiry
  }
}));

// Configure OAuth2 client helper with server-side token auto-refresh saving
function getOAuth2Client() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectURI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/callback';

  if (!clientID || !clientSecret) {
    return null;
  }
  
  const oauth2Client = new google.auth.OAuth2(clientID, clientSecret, redirectURI);
  
  // Listen for refresh events to persist fresh tokens server-side
  oauth2Client.on('tokens', (tokens) => {
    console.log('[OAUTH REFRESH] Received refreshed Google tokens.');
    const currentTokens = db.getOAuthTokens() || {};
    const merged = { ...currentTokens, ...tokens };
    db.setOAuthTokens(merged);
  });

  return oauth2Client;
}

// Retrieve client configured with user's credentials stored in SQLite
function getAuthClientForSession() {
  const client = getOAuth2Client();
  if (!client) return null;

  const tokens = db.getOAuthTokens();
  if (!tokens) return null;

  client.setCredentials(tokens);
  return client;
}

// Helper to construct a base64url encoded MIME raw email
function makeBody(to, subject, bodyText) {
  const str = [
    `To: ${to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    bodyText
  ].join('\n');
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ==========================================================================
   AUTH ENDPOINTS
   ========================================================================== */

app.get('/api/auth/google', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const redirectUrl = process.env.NODE_ENV === 'production' 
    ? '/' 
    : 'http://localhost:3000';

  if (!oauth2Client) {
    console.warn('Google Credentials missing in .env.');
    return res.redirect(`${redirectUrl}/?error=no_credentials`);
  }

  // Generate secure random state token to prevent CSRF attacks
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: state // Pass it to Google
  });

  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  // Validate state token to guard against CSRF hijacking
  if (!state || state !== req.session.oauthState) {
    console.error('[SECURITY ERROR] OAuth State validation failed.');
    return res.status(403).send('Access Denied: OAuth State validation failed (CSRF risk detected).');
  }

  // Clear state after validation
  delete req.session.oauthState;

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return res.redirect('/?error=no_credentials');
  }

  const redirectUrl = process.env.NODE_ENV === 'production' 
    ? '/' 
    : 'http://localhost:3000';

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    db.setOAuthTokens(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const profileRes = await oauth2.userinfo.get();
    
    const profile = {
      name: profileRes.data.name,
      email: profileRes.data.email,
      picture: profileRes.data.picture,
      isLive: true
    };
    db.setUserProfile(profile);

    db.addActivityLog({
      type: 'scan',
      description: 'Synchronized with Google Cloud APIs',
      details: `Connected: Calendar & Gmail feeds active for operator ${profile.email}.`
    });

    // Run agent loop
    await runPlannerLoop(oauth2Client);

    res.redirect(redirectUrl); 
  } catch (err) {
    console.error('Error during OAuth callback:', err);
    res.redirect(`${redirectUrl}/?error=auth_failed`);
  }
});

app.post('/api/auth/mock-login', (req, res) => {
  const mockProfile = {
    name: 'Saksham',
    email: 'saksham@lastcall.ai',
    picture: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDX1k7OU_r4ihYkb37-4AYVpnUwz-GCz_zVyIU0o6TpZbSVoGA5ZslJGvu6yq05FUEhyYdfbDQMqpRWBtuEJHOo57yFz5aY685uXAqSUhyg9PVR0EOnlqocURR-yiMn8vhkKozcaFPFmQKHggDAv0JbHGgIUWhDbZBi7_gnwgo2SsnrB867oY1XqByw3AK03cFVWI6_AEJhdDmY55hjK6CVm37tDwPly4368_eQb3gwXyfyAH3JgypLUGeb95st3hBfWLoP2aV6EZ43',
    isLive: false
  };
  db.setUserProfile(mockProfile);
  
  db.addActivityLog({
    type: 'scan',
    description: 'Connected in Simulator (Mock Mode)',
    details: 'Database pipeline active. Ready for Universal Capture input.'
  });

  res.json(mockProfile);
});

app.get('/api/auth/status', (req, res) => {
  const profile = db.getUserProfile();
  if (profile) {
    res.json({ authenticated: true, user: profile });
  } else {
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/logout', (req, res) => {
  db.clearAuth();
  db.resetAll();
  res.json({ success: true });
});

/* ==========================================================================
   TASKS ENDPOINTS
   ========================================================================== */

app.get('/api/tasks', (req, res) => {
  res.json(db.getTasks());
});

app.post('/api/tasks', (req, res) => {
  const { title, deadline, priority, description } = req.body;
  if (!title || !deadline) {
    return res.status(400).json({ error: 'Title and deadline are required.' });
  }
  const task = db.addTask({ title, deadline, priority: priority || 'medium', description: description || '', source: 'manual' });
  
  db.addActivityLog({
    type: 'deadline_detected',
    description: `Created task manually: "${title}"`,
    details: `Deadline: ${new Date(deadline).toLocaleString()}`
  });

  // Trigger agent loop
  const authClient = getAuthClientForSession();
  runPlannerLoop(authClient).catch(err => console.error(err));

  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  db.deleteTask(req.params.id);
  res.json({ success: true });
});

app.post('/api/tasks/toggle-status', (req, res) => {
  const { id, completed } = req.body;
  const updated = db.updateTask(id, { status: completed ? 'completed' : 'pending' });
  
  if (updated) {
    db.addActivityLog({
      type: 'scan',
      description: `Task "${updated.title}" marked as ${updated.status}`,
      details: 'Re-evaluating focus requirements and queue communications.'
    });

    const authClient = getAuthClientForSession();
    runPlannerLoop(authClient).catch(err => console.error(err));
  }
  res.json(updated);
});

/* ==========================================================================
   UNIVERSAL CAPTURE ENDPOINT
   ========================================================================== */

app.post('/api/tasks/capture', upload.single('screenshot'), async (req, res) => {
  const { text } = req.body;
  const file = req.file;

  if (!text && !file) {
    return res.status(400).json({ error: 'Provide text or upload a screenshot.' });
  }

  try {
    const inputData = {};
    if (file) {
      inputData.file = file.path;
    } else {
      inputData.text = text;
    }

    db.addActivityLog({
      type: 'scan',
      description: file ? 'Analyzing Ingested Screenshot' : 'Analyzing Ingested Chat Copy',
      details: file ? `Source: Screenshot File (${file.originalname})` : `Pasted Content: "${text.substring(0, 80)}..."`
    });

    const parsedTask = await parseCapture(inputData);

    const addedTask = db.addTask({
      title: parsedTask.title,
      deadline: parsedTask.deadline,
      priority: parsedTask.priority,
      description: parsedTask.description,
      source: file ? 'screenshot' : 'manual'
    });

    if (file) {
      fs.unlink(file.path, (err) => {
        if (err) console.error('Failed to clear temp upload:', err);
      });
    }

    db.addActivityLog({
      type: 'deadline_detected',
      description: `Ingested deadline from capture: "${parsedTask.title}"`,
      details: `Deadline parsed: ${new Date(parsedTask.deadline).toLocaleString()}\nContext: ${parsedTask.description}`
    });

    // Run agent loop
    const authClient = getAuthClientForSession();
    runPlannerLoop(authClient).catch(err => console.error(err));

    res.json(addedTask);
  } catch (err) {
    console.error('Capture processing error:', err);
    res.status(500).json({ error: 'Failed to parse deadline assets' });
  }
});

/* ==========================================================================
   ACTIVITY LOG / ACTIONS ENDPOINTS
   ========================================================================== */

app.get('/api/activity', (req, res) => {
  res.json(db.getActivityLog());
});

app.post('/api/activity/approve', async (req, res) => {
  const { logId } = req.body;
  const logItem = db.getActivityLog().find(l => l.id === logId);

  if (!logItem) {
    return res.status(404).json({ error: 'Log entry not found' });
  }

  if (logItem.status !== 'awaiting_approval') {
    return res.status(400).json({ error: 'Action is not awaiting approval' });
  }

  try {
    const action = logItem.action;
    const authClient = getAuthClientForSession();
    
    if (authClient && logItem.type === 'email_draft_created') {
      try {
        const gmail = google.gmail({ version: 'v1', auth: authClient });
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: makeBody(action.to, action.subject, action.body)
          }
        });
        console.log(`[OAUTH LIVE] Sent email via Gmail API to ${action.to}`);
      } catch (gmailErr) {
        console.error('Gmail live send error, falling back to simulation:', gmailErr.message);
      }
    } else {
      console.log(`[SIMULATION SEND] To: ${action.to}\nSubject: ${action.subject}`);
    }

    // Persist status change in SQLite Database
    db.updateActivityLog(logId, { status: 'approved' });

    db.addActivityLog({
      type: 'email_sent',
      description: `Sent Email: "${action.subject}"`,
      details: `Delivered to recipient: ${action.to}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error approving action:', err);
    res.status(500).json({ error: 'Failed to execute approval operations' });
  }
});

app.post('/api/activity/undo', async (req, res) => {
  const { logId } = req.body;
  const logItem = db.getActivityLog().find(l => l.id === logId);

  if (!logItem) {
    return res.status(404).json({ error: 'Log item not found' });
  }

  try {
    const action = logItem.action;

    if (logItem.type === 'email_draft_created') {
      db.updateActivityLog(logId, { status: 'undone' });
      db.addActivityLog({
        type: 'scan',
        description: `Discarded Email Draft: "${action.subject}"`,
        details: 'Draft communication canceled.'
      });
    } 
    else if (logItem.type === 'focus_block_created') {
      if (action && action.blockId) {
        const authClient = getAuthClientForSession();
        if (authClient && action.isLive) {
          try {
            const calendar = google.calendar({ version: 'v3', auth: authClient });
            await calendar.events.delete({
              calendarId: 'primary',
              eventId: action.blockId
            });
            console.log(`[OAUTH LIVE] Deleted Calendar Event: ${action.blockId}`);
          } catch (calErr) {
            console.error('Calendar deletion error on Google:', calErr.message);
          }
        }
        
        db.clearCalendarBlocksForTask(action.taskId);
        db.updateActivityLog(logId, { status: 'undone' });
        
        db.addActivityLog({
          type: 'scan',
          description: `Cancelled focus time block`,
          details: 'Reverted calendar booking.'
        });
      }
    }

    // Run agent loop
    const authClient = getAuthClientForSession();
    runPlannerLoop(authClient).catch(err => console.error(err));

    res.json({ success: true });
  } catch (err) {
    console.error('Error during undo operation:', err);
    res.status(500).json({ error: 'Failed to undo action' });
  }
});

/* ==========================================================================
   AGENT TRIGGERS
   ========================================================================== */

app.get('/api/agent/plan', (req, res) => {
  const plan = db.getLatestPlan() || {
    primaryRecommendation: null,
    riskScore: 0,
    reasoningSteps: ['No active tasks in database. Sentinel idle.'],
    suggestedFocusBlocks: [],
    suggestedEmails: []
  };
  res.json(plan);
});

app.post('/api/agent/replan', async (req, res) => {
  try {
    const authClient = getAuthClientForSession();
    const plan = await runPlannerLoop(authClient);
    res.json(plan);
  } catch (err) {
    console.error('Manual replan execution failed:', err);
    res.status(500).json({ error: 'Failed to run agent loop planning' });
  }
});

// Serve frontend build output
const clientDistPath = path.join(process.cwd(), 'frontend', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Background agent interval checks (every 60 seconds)
setInterval(() => {
  console.log('Background Agent scan check...');
  const authClient = getAuthClientForSession();
  runPlannerLoop(authClient).catch(err => console.log('Background planner loop run bypassed:', err.message));
}, 60000);

// Global Error Handler Middleware to prevent stack trace information disclosure
app.use((err, req, res, next) => {
  console.error('[GLOBAL ERROR HANDLER]:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`LastCall AI Server running on port ${PORT}`);
  console.log(`OAuth Callback: http://localhost:${PORT}/api/auth/callback`);
  console.log(`=========================================`);
});
