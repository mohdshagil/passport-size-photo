# Implementation Plan - Login & Security Integration

This plan outlines the architecture, database schema, API design, and UI changes to integrate a secure user authentication and profile management system into the existing Passport Size Photo Maker application.

## 1. Architectural Decisions

To comply with the constraint **"Do NOT modify, remove, redesign, rename, or break any existing functionality..."**, the integration will be entirely additive:
- **Backend Storage**: A new local `users.db` SQLite database will be initialized automatically by `server.py` on start. This avoids requiring any heavy database engine.
- **Authentication Routes**: New REST endpoints will be added to Python's `CombinedHandler` under `/api/auth/*`.
- **Session Management**: Session tokens will be securely generated (using cryptographically secure random bytes), stored in SQLite, and verified via an HTTP header or secure cookie. Sessions will automatically expire after 1 hour of inactivity.
- **Security**: 
  - Password hashing will use Python's standard `hashlib.pbkdf2_hmac` with a unique salt per user (100,000 iterations of SHA-256).
  - Rate limiting will restrict login attempts (max 5 failed attempts per IP within 15 minutes).
  - Email verification will be simulated: a link containing a secure verification token will be printed in the local server console/terminal, and a mock notification popup will display it to the user.
  - Re-authentication: Confirming the current password will be required before changing the password or deleting the account.
- **Google Sign-In**: A simulated/mocked Google Sign-In pop-up will allow developers/users to experience and use the authentication flow locally without requiring complex OAuth Client secrets.
- **Privacy Notice**: A small privacy notice banner will be added to the Upload controls section.
- **Settings Section**: A dedicated "Login & Security" tab or section will be injected at the top of the sidebar control panel, accessible via a user button.

---

## 2. Proposed Changes

### Database Schema (SQLite)
A new SQLite database (`users.db`) will be created with the following tables:
```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    salt TEXT,
    provider TEXT NOT NULL, -- 'email' or 'google'
    is_verified INTEGER DEFAULT 0,
    verification_token TEXT,
    reset_token TEXT,
    reset_token_expiry INTEGER,
    subscription_plan TEXT DEFAULT 'Free', -- 'Free' or 'Pro'
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    last_activity INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 0,
    last_attempt INTEGER NOT NULL
);
```

### [MODIFY] [server.py](file:///c:/Users/Mohammed%20Shagil/Desktop/passport%20size%20photo/server.py)
We will add SQLite initialization on startup, and add the following API endpoints to `do_POST` and `do_GET` handlers:
- `POST /api/auth/signup`: Validates inputs, checks for uniqueness, hashes password, saves to DB, generates and prints email verification link.
- `POST /api/auth/login`: Checks rate limits, verifies password hash, generates and returns a session token.
- `POST /api/auth/google-login`: Handles Google profile mock payload and logs in or creates user.
- `POST /api/auth/forgot-password`: Generates reset token and prints reset link to console.
- `POST /api/auth/reset-password`: Validates token and updates password.
- `POST /api/auth/change-password`: Requires current password verification, updates password.
- `POST /api/auth/update-profile`: Updates display name/email.
- `POST /api/auth/delete-account`: Requires current password verification, deletes all user data.
- `POST /api/auth/logout`: Clears session token.
- `GET /api/auth/me`: Validates active session, checks for inactivity timeout, updates `last_activity`, and returns user state (including plan status: Free / Pro).
- `GET /api/auth/verify-email?token=...`: Verifies account based on token.

### [MODIFY] [index.html](file:///c:/Users/Mohammed%20Shagil/Desktop/passport%20size%20photo/index.html)
- Inject a "User Account Bar" at the top of the sidebar. When logged in, it shows the name and subscription badge (Free/Pro). When logged out, it shows a "Sign In" button.
- Inject a CSS overlay for authentication modals (Login, Sign Up, Forgot Password, Reset Password).
- Inject a small, clean privacy notice inside `#section-upload`: `"🔒 Privacy Notice: Your photos are processed entirely locally in your browser and are never uploaded to any server."`
- Inject a new "Login & Security Settings" section modal or drawer that opens when a logged-in user clicks on their profile.

### [MODIFY] [style.css](file:///c:/Users/Mohammed%20Shagil/Desktop/passport%20size%20photo/style.css)
- Add styles for the auth bar, modal overlay, inputs, buttons, and custom badges.
- Ensure styling matches the current Inter font, colors, and layout aesthetics.

### [MODIFY] [app.js](file:///c:/Users/Mohammed%20Shagil/Desktop/passport%20size%20photo/app.js)
- Add user session polling or verification on load.
- Handle modal display states (login, signup, forgot password).
- Implement auth network calls to `/api/auth/*`.
- Automatically limit app features for "Guest" users (e.g. limit max slots or copies if in Guest/Free mode, or display a "Go Pro" upgrade prompt).
- Handle session timeout redirects.

---

## 3. Verification Plan

### Automated Verification
We will run:
- Local Python server tests via PowerShell using `Invoke-RestMethod` to verify signup, login, password hashes, rate limiting, and session expirations.

### Manual Verification
1. Open the browser to `http://localhost:8000`.
2. Click "Sign In" -> click "Sign Up" to create an account.
3. Check the Python command line output for the verification token/link. Navigate to it to verify.
4. Log in with correct and incorrect credentials to verify rate-limiting.
5. Change user details, change password, and verify re-authentication.
6. Verify "Forgot Password" flow via console token.
7. Click "Continue as Guest" and check the layout and copies features.
8. Delete the account and verify deletion of session database records.
