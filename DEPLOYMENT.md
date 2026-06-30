# LastCall Deployment Guide (100% Free & No Credit Card Options)

If you want to deploy the application for the hackathon but avoid setting up Google Cloud billing, autopay, or entering credit card details, you have two excellent alternatives:

---

## Option 1: Render.com (Recommended Free Cloud Hosting)
Render is a cloud hosting platform that offers a free tier for web services (Node.js/Express) and **does not require a credit card** to deploy.

### Steps to Deploy on Render:
1. **Push to GitHub**:
   - Commit your code and push it to a private or public GitHub repository.
2. **Create a Render Account**:
   - Go to [Render.com](https://render.com/) and sign up using your GitHub account.
3. **Create a New Web Service**:
   - On the Render dashboard, click **New** -> **Web Service**.
   - Connect your GitHub repository.
4. **Configure Settings**:
   - **Name**: `lastcall-agent` (or similar)
   - **Environment**: `Node`
   - **Region**: Select the closest one.
   - **Branch**: `main` (or your active branch)
   - **Build Command**: `npm install && npm run build --prefix frontend`
   - **Start Command**: `npm start`
   - **Instance Type**: Select **Free** (0$ / month, no card required).
5. **Set Environment Variables**:
   - Click the **Advanced** button and add your environment variables:
     - `PORT`: `3001` (Render override is fine)
     - `SESSION_SECRET`: `your_random_secret_string`
     - `GEMINI_API_KEY`: `your_google_ai_studio_api_key`
     - `GOOGLE_CLIENT_ID`: `your_google_oauth_client_id` (if using live OAuth)
     - `GOOGLE_CLIENT_SECRET`: `your_google_oauth_client_secret` (if using live OAuth)
     - `GOOGLE_REDIRECT_URI`: `https://your-render-subdomain.onrender.com/api/auth/callback` (Make sure this matches the redirect URI in your Google Cloud Console Credentials tab!)
     - `NODE_ENV`: `production`
6. **Deploy**:
   - Click **Create Web Service**. Render will build your React client and launch the Express backend. Your app will be live at `https://your-app-name.onrender.com`.

*Note: The free tier of Render uses an ephemeral disk, meaning the `lastcall.db` SQLite file will reset whenever the container restarts or goes to sleep (after 15 minutes of inactivity). This is perfectly acceptable and expected for a hackathon demo!*

---

## Option 2: Ngrok Tunneling (Local Host to Public URL)
If you want to preserve your local SQLite database data (`lastcall.db`) and don't want to upload credentials to any cloud provider, you can run the app locally and tunnel it to a public URL using **Ngrok**.

### Steps to Deploy via Ngrok:
1. **Build and Start the App Locally**:
   - Open your terminal in the project directory.
   - Run `npm run build --prefix frontend` to compile the frontend.
   - Run `npm start` to launch the server on port `3001`.
2. **Install Ngrok**:
   - Download it from [ngrok.com](https://ngrok.com/) (free sign-up, no card required).
3. **Expose Port 3001**:
   - Open a new terminal window and run:
     ```bash
     ngrok http 3001
     ```
4. **Get your Public URL**:
   - Ngrok will print a forwarding link (e.g. `https://a1b2-34-56-78-90.ngrok-free.app`). 
   - Anyone (including the hackathon judges) can open this URL to access your locally running app!
5. **Update Google Redirect URI (If using live OAuth)**:
   - If using live Google OAuth, go to the Google Cloud Console and add your new Ngrok callback URI:  
     `https://a1b2-34-56-78-90.ngrok-free.app/api/auth/callback`
   - In your local `.env`, update `GOOGLE_REDIRECT_URI` to match.
