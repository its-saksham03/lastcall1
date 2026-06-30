import React, { useState, useEffect, useRef } from 'react';
import ShaderBackground from './ShaderBackground';

export default function App() {
  const [screen, setScreen] = useState('signin'); // 'signin', 'dashboard', 'capture'
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [plannerOutput, setPlannerOutput] = useState({
    primaryRecommendation: null,
    riskScore: 0,
    reasoningSteps: ['LastCall active. Scanner operational.'],
    suggestedFocusBlocks: [],
    suggestedEmails: []
  });
  
  // Forms & UI state
  const [captureText, setCaptureText] = useState('');
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDeadline, setManualDeadline] = useState('');
  const [manualPriority, setManualPriority] = useState('medium');
  const [manualDesc, setManualDesc] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'deadlines', 'intelligence'
  const [apiError, setApiError] = useState(null);
  const [loading, setLoading] = useState(false);

  const fileInputRef = useRef(null);

  // Base API URL config
  const API_BASE =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3001/api'
      : '/api';

  // 1. Fetch user auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // 2. Poll server for tasks and activity log when logged in
  useEffect(() => {
    if (user) {
      fetchData();
      const interval = setInterval(fetchData, 10000); // refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [user]);

  const apiCall = async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = { ...options.headers };
    
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers
    });
    return res;
  };

  const checkAuthStatus = async () => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    if (authError === 'no_credentials') {
      alert('Google OAuth client configuration missing in your .env. Initializing Simulator Mode.');
      window.history.replaceState({}, document.title, window.location.pathname);
      handleMockLogin();
      return;
    } else if (authError === 'auth_failed') {
      alert('OAuth authentication failed. Check your project configuration.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    try {
      const res = await apiCall('/auth/status');
      const data = await res.json();
      if (data.authenticated) {
        setUser(data.user);
        setScreen('dashboard');
      } else {
        setUser(null);
        setScreen('signin');
      }
    } catch (err) {
      console.error('Failed to fetch auth status:', err);
    }
  };

  const fetchData = async () => {
    try {
      const tasksRes = await apiCall('/tasks');
      const tasksData = await tasksRes.json();
      setTasks(tasksData);

      const actRes = await apiCall('/activity');
      const actData = await actRes.json();
      setActivity(actData);

      // Fetch the real persisted plan output from SQLite
      const planRes = await apiCall('/agent/plan');
      const planData = await planRes.json();
      setPlannerOutput(planData);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
  };

  const handleMockLogin = async () => {
    setLoading(true);
    try {
      const res = await apiCall('/auth/mock-login', { method: 'POST' });
      const profile = await res.json();
      setUser(profile);
      setScreen('dashboard');
      setLoading(false);
      // Wait briefly then trigger initial replan
      setTimeout(handleReplan, 1000);
    } catch (err) {
      console.error('Failed mock login:', err);
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setLoading(true);
    window.location.href = `${API_BASE}/auth/google`;
  };

  const handleLogout = async () => {
    try {
      await apiCall('/auth/logout', { method: 'POST' });
      setUser(null);
      setScreen('signin');
      setTasks([]);
      setActivity([]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReplan = async () => {
    setLoading(true);
    try {
      const res = await apiCall('/agent/replan', { method: 'POST' });
      const plan = await res.json();
      setPlannerOutput(plan);
      fetchData();
    } catch (err) {
      console.error('Failed to trigger agent re-plan:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTask = async (id, currentStatus) => {
    try {
      await apiCall('/tasks/toggle-status', {
        method: 'POST',
        body: JSON.stringify({ id, completed: currentStatus !== 'completed' })
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (id) => {
    if (!window.confirm('Delete this deadline commitment?')) return;
    try {
      await apiCall(`/tasks/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualTitle || !manualDeadline) return;
    setLoading(true);
    try {
      await apiCall('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: manualTitle,
          deadline: manualDeadline,
          priority: manualPriority,
          description: manualDesc
        })
      });
      // Clear forms
      setManualTitle('');
      setManualDeadline('');
      setManualPriority('medium');
      setManualDesc('');
      setScreen('dashboard');
      fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshotChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setScreenshotFile(file);
      setScreenshotPreview(URL.createObjectURL(file));
    }
  };

  const handleCaptureSubmit = async (e) => {
    e.preventDefault();
    if (!captureText && !screenshotFile) {
      alert('Please paste some text transcript or drop a screenshot file.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    if (captureText) formData.append('text', captureText);
    if (screenshotFile) formData.append('screenshot', screenshotFile);

    try {
      const res = await apiCall('/tasks/capture', {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) throw new Error('Capture failed');

      // Clear input state
      setCaptureText('');
      setScreenshotFile(null);
      setScreenshotPreview(null);
      setScreen('dashboard');
      fetchData();
    } catch (err) {
      console.error('Universal capture processing error:', err);
      alert('Failed to parse capture content. Ensure server is running.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleApproveAction = async (logId) => {
    try {
      const res = await apiCall('/activity/approve', {
        method: 'POST',
        body: JSON.stringify({ logId })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || 'Failed to approve action');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUndoAction = async (logId) => {
    try {
      const res = await apiCall('/activity/undo', {
        method: 'POST',
        body: JSON.stringify({ logId })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePrimaryRecommendClick = () => {
    if (!plannerOutput.primaryRecommendation) return;
    const recTaskId = plannerOutput.primaryRecommendation.taskId;
    if (!recTaskId) return;

    // Find the drafted email corresponding to this task
    const draftLog = activity.find(
      l => l.action && l.action.taskId === recTaskId && l.status === 'awaiting_approval'
    );
    if (draftLog) {
      handleApproveAction(draftLog.id);
    } else {
      // Just focus calendar schedule
      alert('Recommendation action scheduled successfully!');
    }
  };

  // Helper colors
  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-500/10 text-red-400 border border-red-500/20';
      case 'medium': return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      case 'low': return 'bg-green-500/10 text-green-400 border border-green-500/20';
      default: return 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20';
    }
  };

  return (
    <div className="relative min-h-screen">
      {/* Background shader canvas */}
      <div className="fixed inset-0 w-full h-full -z-10 opacity-40">
        <ShaderBackground type="bg" />
      </div>

      {/* SIGN-IN SCREEN */}
      {screen === 'signin' && (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass-panel p-10 max-w-lg w-full text-center relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-secondary"></div>
            
            <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-4xl text-on-primary font-bold">bolt</span>
            </div>
            
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary mb-4 uppercase">
              LastCall
            </h1>
            
            <p className="text-body-lg text-on-surface-variant mb-8 text-base">
              An AI agent that helps you stop missing deadlines not by reminding you, but by actively planning and executing the next concrete step on your behalf.
            </p>

            <div className="space-y-4">
              <button 
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full py-4 bg-primary text-on-primary font-semibold rounded-xl active-glow hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-lg"
              >
                {loading ? 'Initializing Connection...' : 'Connect with Google'}
                <span className="material-symbols-outlined">key</span>
              </button>
              
              <button 
                onClick={handleMockLogin}
                disabled={loading}
                className="w-full py-4 bg-zinc-800/60 hover:bg-zinc-850/60 border border-white/10 text-on-surface font-semibold rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              >
                Use Simulator (Mock Mode)
                <span className="material-symbols-outlined">dashboard_customize</span>
              </button>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 text-[12px] text-zinc-500 leading-relaxed">
              Google Account link is scoped to Google Calendar focus-time allocation and Gmail drafts modification. No external communications are ever sent without your explicit, one-tap approval.
            </div>
          </div>
        </div>
      )}

      {/* UNIVERSAL CAPTURE SCREEN */}
      {screen === 'capture' && (
        <div className="min-h-screen py-12 px-6 flex items-center justify-center">
          <div className="glass-panel p-8 max-w-2xl w-full relative shadow-2xl">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-secondary"></div>
            
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <span className="material-symbols-outlined text-primary">screenshot_monitor</span>
                Universal Capture Ingestion
              </h2>
              <button 
                onClick={() => setScreen('dashboard')}
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* AI Parsing form */}
            <form onSubmit={handleCaptureSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-2">
                  Drop a Screenshot (WhatsApp, Slack, email snapshot, etc.)
                </label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 hover:border-primary/50 transition-colors rounded-xl p-8 text-center cursor-pointer bg-white/5"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    accept="image/*" 
                    onChange={handleScreenshotChange}
                    className="hidden" 
                  />
                  {screenshotPreview ? (
                    <div className="space-y-3">
                      <img 
                        src={screenshotPreview} 
                        alt="Screenshot preview" 
                        className="max-h-48 mx-auto rounded-lg object-contain border border-white/10" 
                      />
                      <p className="text-xs text-primary font-medium">{screenshotFile?.name}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <span className="material-symbols-outlined text-4xl text-zinc-400">upload_file</span>
                      <p className="text-sm text-zinc-300">Drag & drop or click to upload deadline screenshot</p>
                      <p className="text-xs text-zinc-500">Supports PNG, JPG, JPEG</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-2">
                  Paste Text (Slack / WhatsApp message transcript or email copy)
                </label>
                <textarea 
                  rows={4}
                  value={captureText}
                  onChange={(e) => setCaptureText(e.target.value)}
                  placeholder="e.g. 'Saksham, please submit the design phase docs by tomorrow at 5pm. No late work allowed!'..."
                  className="w-full bg-zinc-950/60 border border-white/10 focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-sm placeholder-zinc-500 text-on-surface resize-none"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="h-[1px] bg-white/5 flex-1"></div>
                <span className="text-xs text-zinc-500 uppercase tracking-widest">or fallback manual entry</span>
                <div className="h-[1px] bg-white/5 flex-1"></div>
              </div>

              {/* Manual Fallbacks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Task Title</label>
                  <input 
                    type="text" 
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="Submit Project Proposal"
                    className="w-full bg-zinc-950/60 border border-white/10 focus:border-primary focus:ring-0 rounded-xl px-4 py-2 text-sm text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Due Date / Time</label>
                  <input 
                    type="datetime-local" 
                    value={manualDeadline}
                    onChange={(e) => setManualDeadline(e.target.value)}
                    className="w-full bg-zinc-950/60 border border-white/10 focus:border-primary focus:ring-0 rounded-xl px-4 py-2 text-sm text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Priority</label>
                  <select 
                    value={manualPriority}
                    onChange={(e) => setManualPriority(e.target.value)}
                    className="w-full bg-zinc-950/60 border border-white/10 focus:border-primary focus:ring-0 rounded-xl px-4 py-2 text-sm text-on-surface"
                  >
                    <option value="high">High (Critical)</option>
                    <option value="medium">Medium (Regular)</option>
                    <option value="low">Low (Flexible)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Context Notes</label>
                  <input 
                    type="text" 
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    placeholder="Short description/context notes"
                    className="w-full bg-zinc-950/60 border border-white/10 focus:border-primary focus:ring-0 rounded-xl px-4 py-2 text-sm text-on-surface"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button 
                  type="submit"
                  disabled={isUploading}
                  className="flex-1 py-4 bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-container font-semibold rounded-xl active-glow hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {isUploading ? 'AI Analyzing Ingestion...' : 'Ingest & Plan with Gemini'}
                  <span className="material-symbols-outlined">bolt</span>
                </button>
                <button 
                  type="button"
                  onClick={handleManualSubmit}
                  disabled={loading || !manualTitle || !manualDeadline}
                  className="py-4 px-6 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold rounded-xl active:scale-[0.98] transition-all"
                >
                  Manual Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DASHBOARD SCREEN */}
      {screen === 'dashboard' && user && (
        <div className="min-h-screen">
          {/* Top AppBar */}
          <header className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-8 md:px-16 py-4 w-full bg-surface/40 backdrop-blur-xl border-b border-white/10 shadow-sm">
            <div className="flex items-center gap-8">
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary tracking-widest uppercase">
                LASTCALL
              </span>
              <div className="hidden md:flex gap-6">
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className={`text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'text-primary' : 'text-on-surface-variant hover:text-white'}`}
                >
                  Overview
                </button>
                <button 
                  onClick={() => setActiveTab('deadlines')}
                  className={`text-sm font-medium transition-colors ${activeTab === 'deadlines' ? 'text-primary' : 'text-on-surface-variant hover:text-white'}`}
                >
                  Tracked Deadlines ({tasks.length})
                </button>
                <button 
                  onClick={() => setActiveTab('intelligence')}
                  className={`text-sm font-medium transition-colors ${activeTab === 'intelligence' ? 'text-primary' : 'text-on-surface-variant hover:text-white'}`}
                >
                  System Log
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded border ${user.isLive ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10'}`}>
                {user.isLive ? 'Live API Active' : 'Simulator Mode'}
              </span>
              <button 
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 transition-colors rounded-full"
                title="Disconnect Sentinel"
              >
                <span className="material-symbols-outlined text-xl">logout</span>
              </button>
            </div>
          </header>

          {/* Left Navigation Sidebar */}
          <aside className="fixed left-0 top-0 bottom-0 flex flex-col z-40 bg-surface-container/40 backdrop-blur-[32px] h-[calc(100vh-48px)] w-64 rounded-xl m-6 border border-white/10 shadow-2xl mt-24">
            <div className="p-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <span className="material-symbols-outlined text-on-primary">shield</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-primary">LastCall</h2>
                <p className="text-[10px] text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary status-pulse"></span>
                  Sentinel Active
                </p>
              </div>
            </div>

            <nav className="flex-1 px-4 space-y-1 mt-6">
              <button 
                onClick={() => { setActiveTab('dashboard'); setScreen('dashboard'); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === 'dashboard' ? 'bg-secondary-container/60 text-on-secondary-container shadow-[0_0_10px_rgba(208,188,255,0.25)]' : 'text-on-surface-variant hover:bg-white/5 hover:translate-x-1'}`}
              >
                <span className="material-symbols-outlined">dashboard</span>
                <span className="text-sm font-medium">Dashboard</span>
              </button>
              <button 
                onClick={() => { setActiveTab('deadlines'); setScreen('dashboard'); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === 'deadlines' ? 'bg-secondary-container/60 text-on-secondary-container shadow-[0_0_10px_rgba(208,188,255,0.25)]' : 'text-on-surface-variant hover:bg-white/5 hover:translate-x-1'}`}
              >
                <span className="material-symbols-outlined">alarm_on</span>
                <span className="text-sm font-medium">Deadlines</span>
              </button>
              <button 
                onClick={() => { setActiveTab('intelligence'); setScreen('dashboard'); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === 'intelligence' ? 'bg-secondary-container/60 text-on-secondary-container shadow-[0_0_10px_rgba(208,188,255,0.25)]' : 'text-on-surface-variant hover:bg-white/5 hover:translate-x-1'}`}
              >
                <span className="material-symbols-outlined">psychology</span>
                <span className="text-sm font-medium">Intelligence Log</span>
              </button>
            </nav>

            <div className="p-6 mt-auto border-t border-white/5">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full overflow-hidden border border-primary/30">
                  <img 
                    src={user.picture} 
                    alt={user.name} 
                    className="w-full h-full object-cover" 
                    onError={(e) => { e.target.src = 'https://via.placeholder.com/150'; }}
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-on-surface">{user.name}</span>
                  <span className="text-[10px] text-tertiary">Sentinel Operator</span>
                </div>
              </div>
              <button 
                onClick={() => setScreen('capture')}
                className="w-full py-3 bg-primary text-on-primary rounded-xl font-semibold flex items-center justify-center gap-2 hover:opacity-95 active:scale-95 transition-all shadow-md"
              >
                <span className="material-symbols-outlined text-lg">add</span>
                Universal Capture
              </button>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="ml-80 mr-96 pt-28 pb-24 min-h-screen px-8">
            {/* Active Tab: Dashboard Overview */}
            {activeTab === 'dashboard' && (
              <div>
                {/* Welcome Header */}
                <header className="mb-10">
                  <h1 className="text-4xl font-bold text-on-surface">
                    Good Morning, <span className="text-primary">{user.name}</span>.
                  </h1>
                  <p className="text-zinc-400 mt-2">
                    Your AI Sentinel loop has completed calendar scanning and email triage.
                  </p>
                </header>

                {/* Orb Shader Panel */}
                <section className="flex flex-col items-center justify-center mb-10 p-6 glass-panel border-white/5 relative overflow-hidden">
                  <div className="relative w-40 h-40 mb-4 rounded-full overflow-hidden shadow-lg">
                    <ShaderBackground type="orb" />
                    <div className="absolute inset-0 bg-primary/10 blur-xl rounded-full"></div>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-1.5 glass-panel rounded-full border-primary/20 bg-zinc-900/60">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary status-pulse"></div>
                    <span className="text-[10px] font-bold text-primary tracking-widest uppercase">Sentinel Scanning Inbox</span>
                  </div>
                </section>

                {/* Single Primary Recommendation Card (Hero) */}
                <section className="mb-10">
                  {plannerOutput.primaryRecommendation ? (
                    <div className="glass-panel p-8 relative overflow-hidden group shadow-lg">
                      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-primary to-secondary"></div>
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${plannerOutput.primaryRecommendation.urgency === 'Critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                            {plannerOutput.primaryRecommendation.urgency} Action Recommended
                          </span>
                          <h2 className="text-2xl font-bold text-on-surface mt-4">
                            {plannerOutput.primaryRecommendation.title}
                          </h2>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-400">Threat Horizon</div>
                          <div className="text-2xl font-bold text-primary mt-1">
                            {plannerOutput.primaryRecommendation.effortMinutes}m Required
                          </div>
                        </div>
                      </div>

                      <p className="text-zinc-300 text-sm mb-6 leading-relaxed bg-white/5 p-4 rounded-lg border border-white/5">
                        {plannerOutput.primaryRecommendation.reason}
                      </p>

                      <div className="flex items-center gap-4">
                        <button 
                          onClick={handlePrimaryRecommendClick}
                          className="flex-1 py-4 bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-container font-bold text-base rounded-xl active-glow hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg"
                        >
                          Approve and Execute Immediate Action
                          <span className="material-symbols-outlined text-lg">bolt</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel p-10 text-center shadow-lg border-white/5">
                      <span className="material-symbols-outlined text-5xl text-zinc-600 mb-4">task_alt</span>
                      <h3 className="text-lg font-semibold text-zinc-300">All Deadlines Safe</h3>
                      <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
                        No immediate action requires approval. Add tasks manually, connect Google Calendar, or drop a screenshot to initialize planning.
                      </p>
                      <button 
                        onClick={() => setScreen('capture')}
                        className="mt-6 px-6 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary rounded-xl font-medium text-sm transition-all"
                      >
                        Ingest New Deadline
                      </button>
                    </div>
                  )}
                </section>

                {/* AI Activity Log / Feed */}
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-xl">terminal</span>
                      Agent Activity Log
                    </h3>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Live Feedback</span>
                  </div>

                  <div className="space-y-4">
                    {activity.length === 0 ? (
                      <div className="p-8 text-center text-zinc-500 text-sm glass-panel border-dashed border-white/5">
                        Activity feed empty. Scanner status: IDLE
                      </div>
                    ) : (
                      activity.map((item) => {
                        const isAwaiting = item.status === 'awaiting_approval';
                        return (
                          <div key={item.id} className={`glass-panel p-5 flex items-start gap-4 transition-all relative border border-white/5 hover:border-white/10 ${isAwaiting ? 'border-primary/35 shadow-[0_0_10px_rgba(173,198,255,0.08)] bg-zinc-900/40' : ''}`}>
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                              item.type.includes('email') ? 'bg-primary/10 text-primary' :
                              item.type.includes('calendar') || item.type.includes('focus') ? 'bg-emerald-500/10 text-emerald-400' :
                              item.type.includes('deadline') ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-zinc-400'
                            }`}>
                              <span className="material-symbols-outlined text-xl">
                                {item.type.includes('email') ? 'mail' :
                                 item.type.includes('calendar') || item.type.includes('focus') ? 'calendar_today' :
                                 item.type.includes('deadline') ? 'notification_important' : 'search'}
                              </span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start gap-2">
                                <h4 className="text-sm font-semibold text-on-surface truncate">{item.description}</h4>
                                <span className="text-[10px] text-zinc-500 shrink-0">{new Date(item.timestamp).toLocaleTimeString()}</span>
                              </div>
                              <p className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap leading-relaxed font-mono bg-black/20 p-2.5 rounded border border-white/5 mt-2">
                                {item.details}
                              </p>

                              {/* Autonomy human-gate action items */}
                              {isAwaiting && item.action && (
                                <div className="mt-4 flex items-center gap-3">
                                  <button 
                                    onClick={() => handleApproveAction(item.id)}
                                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold text-xs rounded-lg active:scale-95 transition-all flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">send</span>
                                    Approve & Send Email
                                  </button>
                                  <button 
                                    onClick={() => handleUndoAction(item.id)}
                                    className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-xs rounded-lg active:scale-95 transition-all"
                                  >
                                    Discard Draft
                                  </button>
                                </div>
                              )}

                              {!isAwaiting && item.status === 'approved' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest mt-3">
                                  <span className="material-symbols-outlined text-[12px] font-bold">check_circle</span>
                                  Approved & Executed
                                </span>
                              )}

                              {!isAwaiting && item.status === 'undone' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-3">
                                  <span className="material-symbols-outlined text-[12px] font-bold">cancel</span>
                                  Discarded / Undone
                                </span>
                              )}

                              {!isAwaiting && item.type === 'focus_block_created' && item.status === 'done' && (
                                <div className="mt-3 flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                                    <span className="material-symbols-outlined text-[12px] font-bold">event</span>
                                    Calendar Event Scheduled
                                  </span>
                                  <button 
                                    onClick={() => handleUndoAction(item.id)}
                                    className="text-[10px] text-zinc-400 hover:text-white underline hover:no-underline transition-colors"
                                  >
                                    Delete Focus Block
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* Active Tab: Tracked Deadlines */}
            {activeTab === 'deadlines' && (
              <div>
                <header className="mb-10">
                  <h1 className="text-3xl font-bold text-on-surface">Tracked Commitments</h1>
                  <p className="text-zinc-400 mt-2">All tasks and schedule items triaged by LastCall.</p>
                </header>

                <div className="glass-panel p-6 shadow-lg border-white/5 space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-white/5">
                    <h3 className="text-base font-bold">Deadline List</h3>
                    <button 
                      onClick={() => setScreen('capture')}
                      className="px-4 py-2 bg-primary text-on-primary font-semibold text-xs rounded-lg active:scale-95 transition-all flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      Add Commitment
                    </button>
                  </div>

                  {tasks.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500 text-sm">
                      No deadlines currently tracked. Capture a task to start.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {tasks.map((task) => (
                        <div key={task.id} className="py-4 flex items-center justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <button 
                              onClick={() => handleToggleTask(task.id, task.status)}
                              className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${task.status === 'completed' ? 'bg-primary border-primary text-on-primary' : 'border-white/20 hover:border-primary'}`}
                            >
                              {task.status === 'completed' && <span className="material-symbols-outlined text-[14px] font-bold">check</span>}
                            </button>
                            <div className="min-w-0">
                              <h4 className={`text-sm font-semibold truncate ${task.status === 'completed' ? 'line-through text-zinc-500' : 'text-white'}`}>
                                {task.title}
                              </h4>
                              <p className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap truncate max-w-lg">{task.description}</p>
                              <div className="flex items-center gap-3 mt-2 flex-wrap">
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${getPriorityBadge(task.priority)}`}>
                                  {task.priority}
                                </span>
                                <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">schedule</span>
                                  Due: {new Date(task.deadline).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button 
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-2 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors shrink-0"
                            title="Delete commitment"
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Active Tab: System Logs */}
            {activeTab === 'intelligence' && (
              <div>
                <header className="mb-10">
                  <h1 className="text-3xl font-bold text-on-surface">Intelligence Feed</h1>
                  <p className="text-zinc-400 mt-2">Historical list of all system actions, scans, and human overrides.</p>
                </header>

                <div className="glass-panel p-6 shadow-lg border-white/5 space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-white/5">
                    <h3 className="text-base font-bold">Historical Record</h3>
                    <button 
                      onClick={handleReplan}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-xs rounded-lg active:scale-95 transition-all flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                      Force Re-scan
                    </button>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {activity.map((log) => (
                      <div key={log.id} className="text-xs font-mono p-4 bg-zinc-950/60 rounded border border-white/5 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <span className="text-primary font-bold">[{log.type.toUpperCase()}]</span>
                          <span className="text-zinc-500">{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-zinc-300">{log.description}</p>
                        {log.details && (
                          <div className="bg-black/40 p-2 rounded border border-white/5 text-zinc-500 text-[10px] whitespace-pre-wrap leading-relaxed">
                            {log.details}
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-1">
                          <span className="text-[10px] text-zinc-400">ID: {log.id}</span>
                          <span className={`text-[10px] font-bold uppercase ${log.status === 'awaiting_approval' ? 'text-yellow-400' : log.status === 'approved' || log.status === 'done' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                            Status: {log.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </main>

          {/* Right Side Reasoning Panel */}
          <aside className="fixed right-0 top-0 bottom-0 w-80 m-6 z-40 space-y-6 mt-24">
            {/* Risk Score Circle */}
            <div className="glass-panel p-6 flex flex-col items-center justify-center text-center shadow-2xl relative border border-white/10 bg-surface-container/40 backdrop-blur-[32px]">
              <h4 className="text-xs font-bold text-zinc-400 mb-6 uppercase tracking-widest">Global Risk Index</h4>
              <div className="relative w-28 h-28 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90">
                  <circle 
                    cx="56" 
                    cy="56" 
                    fill="none" 
                    r="48" 
                    stroke="rgba(255,255,255,0.05)" 
                    strokeWidth="8"
                  />
                  <circle 
                    cx="56" 
                    cy="56" 
                    fill="none" 
                    r="48" 
                    stroke="#adc6ff" 
                    strokeDasharray="301.6" 
                    strokeDashoffset={301.6 - (301.6 * plannerOutput.riskScore) / 100} 
                    strokeWidth="8"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-on-surface leading-none">{plannerOutput.riskScore}%</span>
                </div>
              </div>
              <p className="text-[11px] text-zinc-400 mt-4 uppercase tracking-wider font-bold">
                {plannerOutput.riskScore > 70 ? '⚠️ Schedule At Risk' : plannerOutput.riskScore > 30 ? '⚡ Elevated Conflict' : '🟢 Schedule Secured'}
              </p>
            </div>

            {/* AI Reasoning Flow */}
            <div className="glass-panel p-6 h-[calc(100vh-280px)] flex flex-col overflow-hidden shadow-2xl border border-white/10 bg-surface-container/40 backdrop-blur-[32px]">
              <h4 className="text-xs font-bold text-zinc-400 mb-6 uppercase tracking-widest">AI Reasoning Flow</h4>
              <div className="flex-1 overflow-y-auto space-y-6 relative pr-1">
                {plannerOutput.reasoningSteps.map((step, idx) => (
                  <div key={idx} className="relative z-10">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-primary font-mono">{idx + 1}</span>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-300 leading-relaxed font-mono">
                          {step.replace(/^\d+\.\s*/, '')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-4 border-t border-white/5">
                <button 
                  onClick={handleReplan}
                  disabled={loading}
                  className="w-full py-3 bg-zinc-900 hover:bg-zinc-850 border border-white/10 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  <span className="material-symbols-outlined text-[14px]">sync</span>
                  {loading ? 'Thinking...' : 'Force AI Re-plan'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
