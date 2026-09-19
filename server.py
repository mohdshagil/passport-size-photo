# Combined Local File Server & Remove.bg API CORS Proxy
import http.server
import socketserver
import urllib.request
import urllib.error
import json
import sys
import os
import sqlite3
import hashlib
import time
import uuid
import secrets
import re
import html as html_module
import hmac
import base64

PORT = int(os.environ.get('PORT', 8000))
DB_FILE = os.environ.get('DB_FILE', 'users.db')

# Security: max request body size for auth endpoints (10 KB)
MAX_AUTH_BODY_SIZE = 10 * 1024  # 10 KB

# Security: token must be exactly 64 lowercase hex chars
TOKEN_RE = re.compile(r'^[0-9a-f]{64}$')

# Security: allowed CORS origin (localhost only)
ALLOWED_ORIGIN = 'http://localhost:8000'

# ─── Cashfree Payment Gateway Configuration ───────────────────────────────────
CASHFREE_CLIENT_ID = os.environ.get('CASHFREE_CLIENT_ID', '')
CASHFREE_CLIENT_SECRET = os.environ.get('CASHFREE_CLIENT_SECRET', '')
CASHFREE_ENV = os.environ.get('CASHFREE_ENV', 'sandbox')  # 'sandbox' or 'production'
CASHFREE_API_VERSION = '2025-01-01'

def get_cashfree_base_url():
    if CASHFREE_ENV == 'production':
        return 'https://api.cashfree.com/pg'
    return 'https://sandbox.cashfree.com/pg'

# Subscription plan definitions
PLAN_CONFIG = {
    'monthly':  {'name': 'Monthly',    'amount': 99,   'duration_days': 30,   'label': '₹99/month'},
    '6months':  {'name': '6 Months',   'amount': 499,  'duration_days': 180,  'label': '₹499 for 6 months'},
    'yearly':   {'name': 'Yearly',     'amount': 999,  'duration_days': 365,  'label': '₹999/year'},
    'lifetime': {'name': 'Lifetime',   'amount': 2999, 'duration_days': 36500, 'label': '₹2999 lifetime'},
}

TRIAL_DURATION_DAYS = 7

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            salt TEXT,
            provider TEXT NOT NULL,
            is_verified INTEGER DEFAULT 0,
            verification_token TEXT,
            reset_token TEXT,
            reset_token_expiry INTEGER,
            subscription_plan TEXT DEFAULT 'Free',
            created_at INTEGER NOT NULL,
            trial_started_at INTEGER,
            trial_expires_at INTEGER,
            plan_expires_at INTEGER,
            plan_type TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            last_activity INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS login_attempts (
            ip TEXT PRIMARY KEY,
            attempts INTEGER DEFAULT 0,
            last_attempt INTEGER NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            plan_type TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'INR',
            status TEXT DEFAULT 'PENDING',
            cashfree_order_id TEXT,
            payment_session_id TEXT,
            cf_payment_id TEXT,
            payment_method TEXT,
            created_at INTEGER NOT NULL,
            paid_at INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')
    # Migration: add new columns to existing users table if they don't exist
    try:
        c.execute('ALTER TABLE users ADD COLUMN trial_started_at INTEGER')
    except sqlite3.OperationalError:
        pass
    try:
        c.execute('ALTER TABLE users ADD COLUMN trial_expires_at INTEGER')
    except sqlite3.OperationalError:
        pass
    try:
        c.execute('ALTER TABLE users ADD COLUMN plan_expires_at INTEGER')
    except sqlite3.OperationalError:
        pass
    try:
        c.execute('ALTER TABLE users ADD COLUMN plan_type TEXT')
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()


def check_plan_status(user_id):
    """Check if user's plan has expired and downgrade if needed. Returns current effective plan."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT subscription_plan, plan_expires_at, trial_expires_at, plan_type FROM users WHERE id = ?', (user_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return 'Free'
    
    plan, plan_expires, trial_expires, plan_type = row
    now = int(time.time())
    
    if plan == 'Pro':
        # Check if it's a trial
        if plan_type == 'trial' and trial_expires and now > trial_expires:
            c.execute('UPDATE users SET subscription_plan = ?, plan_type = NULL WHERE id = ?', ('Free', user_id))
            conn.commit()
            conn.close()
            return 'Free'
        # Check if paid plan has expired
        if plan_type != 'lifetime' and plan_expires and now > plan_expires:
            c.execute('UPDATE users SET subscription_plan = ?, plan_type = NULL WHERE id = ?', ('Free', user_id))
            conn.commit()
            conn.close()
            return 'Free'
    
    conn.close()
    return plan


def cashfree_create_order(order_id, amount, customer_id, customer_email, customer_phone, customer_name, return_url, notify_url=None):
    """Create a Cashfree order and return payment_session_id."""
    if not notify_url:
        notify_url = return_url.split('/?')[0] + '/api/payment/webhook'
    url = f"{get_cashfree_base_url()}/orders"
    payload = json.dumps({
        'order_id': order_id,
        'order_amount': amount,
        'order_currency': 'INR',
        'customer_details': {
            'customer_id': customer_id,
            'customer_email': customer_email,
            'customer_phone': customer_phone or '9999999999',
            'customer_name': customer_name
        },
        'order_meta': {
            'return_url': return_url,
            'notify_url': notify_url
        }
    }).encode('utf-8')
    
    headers = {
        'Content-Type': 'application/json',
        'x-client-id': CASHFREE_CLIENT_ID,
        'x-client-secret': CASHFREE_CLIENT_SECRET,
        'x-api-version': CASHFREE_API_VERSION
    }
    
    req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f'[Cashfree Error] {e.code}: {error_body}')
        return None
    except Exception as e:
        print(f'[Cashfree Error] {e}')
        return None


def cashfree_get_order(order_id):
    """Fetch order status from Cashfree."""
    url = f"{get_cashfree_base_url()}/orders/{order_id}"
    headers = {
        'x-client-id': CASHFREE_CLIENT_ID,
        'x-client-secret': CASHFREE_CLIENT_SECRET,
        'x-api-version': CASHFREE_API_VERSION
    }
    req = urllib.request.Request(url, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f'[Cashfree Order Fetch Error] {e.code}: {error_body}')
        return None
    except Exception as e:
        print(f'[Cashfree Order Fetch Error] {e}')
        return None


def verify_cashfree_webhook(timestamp, raw_body, signature):
    """Verify Cashfree webhook signature using HMAC-SHA256."""
    if not CASHFREE_CLIENT_SECRET:
        return False
    message = timestamp + raw_body
    computed = hmac.new(
        CASHFREE_CLIENT_SECRET.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).digest()
    encoded = base64.b64encode(computed).decode('utf-8')
    return hmac.compare_digest(encoded, signature)

# Initialize DB on startup
init_db()

def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    ).hex()
    return pw_hash, salt

def is_rate_limited(ip):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT attempts, last_attempt FROM login_attempts WHERE ip = ?', (ip,))
    row = c.fetchone()
    conn.close()
    if row:
        attempts, last_attempt = row
        # Limit to 5 attempts within 15 minutes (900 seconds)
        if attempts >= 5 and (time.time() - last_attempt) < 900:
            return True
    return False

def record_login_attempt(ip, success):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    if success:
        c.execute('DELETE FROM login_attempts WHERE ip = ?', (ip,))
    else:
        c.execute('SELECT attempts FROM login_attempts WHERE ip = ?', (ip,))
        row = c.fetchone()
        now = int(time.time())
        if row:
            attempts = row[0]
            c.execute('UPDATE login_attempts SET attempts = ?, last_attempt = ? WHERE ip = ?', (attempts + 1, now, ip))
        else:
            c.execute('INSERT INTO login_attempts (ip, attempts, last_attempt) VALUES (?, 1, ?)', (ip, now))
    conn.commit()
    conn.close()

def sanitize_log(value):
    """Strip newlines/carriage-returns from user-controlled strings before logging (prevent log injection)."""
    if not isinstance(value, str):
        value = str(value)
    return value.replace('\r', '').replace('\n', ' ').strip()

class CombinedHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        """Serve static files with cache-busting headers, intercepting auth routes."""
        # Security: block direct GET access to sensitive files (database, source code, config files, dotfiles)
        import urllib.parse
        normalized_path = self.path.split('?')[0].split('#')[0].lower()
        normalized_path = urllib.parse.unquote(normalized_path)
        
        # Blacklist sensitive extensions and dotfiles
        if normalized_path.endswith('.db') or \
           normalized_path.endswith('.py') or \
           normalized_path.endswith('.sqlite') or \
           normalized_path.endswith('.sqlite3') or \
           normalized_path.endswith('.md') or \
           normalized_path.endswith('.log') or \
           '/.' in normalized_path or \
           normalized_path.startswith('/.'):
            self.send_response(403)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b"Forbidden: Access to this file is prohibited.")
            return

        if self.path.startswith('/api/auth/verify-email'):
            # Parse and validate token from query string
            token = ''
            parts = self.path.split('?token=')
            if len(parts) > 1:
                token = parts[1].split('&')[0]
            # Fix 4: validate token is exactly 64 hex chars before any DB lookup
            if not TOKEN_RE.match(token):
                self.send_response(400)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                error_html = '<h3>Invalid verification token format.</h3><br><a href="/">Go back to App</a>'
                self.send_header('Content-Length', str(len(error_html.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(error_html.encode('utf-8'))
                return

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT id, name FROM users WHERE verification_token = ?', (token,))
            user = c.fetchone()
            if user:
                user_id, name = user
                c.execute('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?', (user_id,))
                conn.commit()
                conn.close()

                # Fix 1: HTML-escape name to prevent stored XSS
                safe_name = html_module.escape(name)
                html = f"""<!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none';">
                  <title>Email Verified - Passport Photo Maker</title>
                  <style>
                    body {{ font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f8fafc; }}
                    .card {{ background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); text-align: center; max-width: 400px; border: 1px solid #e2e8f0; }}
                    h1 {{ color: #10b981; margin-top: 0; margin-bottom: 12px; font-size: 24px; font-weight: 700; }}
                    p {{ color: #64748b; margin-bottom: 24px; line-height: 1.6; font-size: 15px; }}
                    .btn {{ background: #4f46e5; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; transition: background 0.2s; }}
                    .btn:hover {{ background: #4338ca; }}
                  </style>
                </head>
                <body>
                  <div class="card">
                    <h1>Email Verified!</h1>
                    <p>Hi {safe_name}, your email has been verified successfully. You can now close this window and log in to the application.</p>
                    <a href="/" class="btn">Go to App</a>
                  </div>
                </body>
                </html>"""
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(html.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(html.encode('utf-8'))
            else:
                conn.close()
                self.send_response(400)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                error_html = "<h3>Invalid or expired verification token.</h3><br><a href='/'>Go back to App</a>"
                self.send_header('Content-Length', str(len(error_html.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(error_html.encode('utf-8'))
            return

        elif self.path == '/api/auth/me':
            user, _ = self.get_auth_user()
            if not user:
                self._json_error(401, 'Unauthorized.')
                return

            response_body = json.dumps({ 'user': user }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
            return

        elif self.path == '/api/auth/subscription-status':
            user, _ = self.get_auth_user()
            if not user:
                self._json_error(401, 'Unauthorized.')
                return

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('''
                SELECT subscription_plan, plan_type, trial_started_at, trial_expires_at, plan_expires_at
                FROM users WHERE id = ?
            ''', (user['id'],))
            urow = c.fetchone()

            # Fetch order history
            c.execute('''
                SELECT order_id, plan_type, amount, currency, status, payment_method, created_at, paid_at
                FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
            ''', (user['id'],))
            orders = []
            for o in c.fetchall():
                orders.append({
                    'order_id': o[0], 'plan_type': o[1], 'amount': o[2],
                    'currency': o[3], 'status': o[4], 'payment_method': o[5],
                    'created_at': o[6], 'paid_at': o[7]
                })
            conn.close()

            plan_info = {
                'plan': urow[0] if urow else 'Free',
                'plan_type': urow[1] if urow else None,
                'trial_started_at': urow[2] if urow else None,
                'trial_expires_at': urow[3] if urow else None,
                'plan_expires_at': urow[4] if urow else None,
                'orders': orders
            }

            response_body = json.dumps(plan_info).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
            return

        # Let the parent handle the file serving, we intercept send_response
        super().do_GET()

    def list_directory(self, path):
        # Security: Disable directory listing to prevent information disclosure
        self.send_error(403, "Directory listing is forbidden.")
        return None


    def get_auth_user(self):
        # Fix 7: Only accept session tokens from secure HttpOnly cookies (removed dead Bearer auth path)
        token = ''
        cookie_header = self.headers.get('Cookie', '')
        match = re.search(r'session_token=([0-9a-f]{64})', cookie_header)
        if match:
            token = match.group(1)
        if not token:
            return None, None

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute('''
            SELECT u.id, u.name, u.email, u.subscription_plan, u.is_verified, s.last_activity, u.provider,
                   u.trial_started_at, u.trial_expires_at, u.plan_expires_at, u.plan_type
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
        ''', (token,))
        row = c.fetchone()
        if not row:
            conn.close()
            return None, None

        user_id, name, email, plan, is_verified, last_activity, provider, trial_started, trial_expires, plan_expires, plan_type = row
        now = int(time.time())
        # Session expiration: 1 hour (3600 seconds)
        if now - last_activity > 3600:
            c.execute('DELETE FROM sessions WHERE token = ?', (token,))
            conn.commit()
            conn.close()
            return None, None

        # Update last activity
        c.execute('UPDATE sessions SET last_activity = ? WHERE token = ?', (now, token))
        conn.commit()
        conn.close()

        # Check plan expiry and auto-downgrade if needed
        effective_plan = check_plan_status(user_id)

        return {
            'id': user_id,
            'name': name,
            'email': email,
            'plan': effective_plan,
            'is_verified': is_verified,
            'provider': provider,
            'trial_started_at': trial_started,
            'trial_expires_at': trial_expires,
            'plan_expires_at': plan_expires,
            'plan_type': plan_type
        }, token

    def do_POST(self):
        """Proxy POST /api/removebg to Remove.bg API or handle User Authentication."""
        if self.path.startswith('/api/auth/'):
            content_length = int(self.headers.get('Content-Length', 0))
            # Fix 3: enforce max body size for auth endpoints (10 KB)
            if content_length > MAX_AUTH_BODY_SIZE:
                self._json_error(413, 'Request body too large.')
                return
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8')) if content_length > 0 else {}
            except Exception as e:
                self._json_error(400, 'Invalid JSON body.')
                return

            if self.path == '/api/auth/signup':
                name = data.get('name', '').strip()
                email = data.get('email', '').strip().lower()
                password = data.get('password', '')

                if not name or not email or not password:
                    self._json_error(400, 'All fields are required.')
                    return

                if len(password) < 6:
                    self._json_error(400, 'Password must be at least 6 characters long.')
                    return

                if not re.match(r'[^@]+@[^@]+\.[^@]+', email):
                    self._json_error(400, 'Invalid email format.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT id FROM users WHERE email = ?', (email,))
                if c.fetchone():
                    conn.close()
                    self._json_error(400, 'Email already exists.')
                    return

                user_id = str(uuid.uuid4())
                pw_hash, salt = hash_password(password)
                verify_token = secrets.token_hex(32)
                now = int(time.time())

                c.execute('''
                    INSERT INTO users (id, name, email, password_hash, salt, provider, is_verified, verification_token, created_at)
                    VALUES (?, ?, ?, ?, ?, 'email', 0, ?, ?)
                ''', (user_id, name, email, pw_hash, salt, verify_token, now))
                conn.commit()
                conn.close()

                verify_link = f"http://localhost:8000/api/auth/verify-email?token={verify_token}"
                print("\n" + "="*80)
                # Fix 6: sanitize user-controlled values before logging (log injection prevention)
                print(f"[EMAIL SIMULATION] Verification email sent to: {sanitize_log(email)}")
                print(f"Verify Account Link: {verify_link}")
                print("="*80 + "\n")

                response_body = json.dumps({
                    'message': 'Signup successful. Please verify your email.',
                    'verifyLink': verify_link
                }).encode('utf-8')

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/login':
                email = data.get('email', '').strip().lower()
                password = data.get('password', '')
                ip = self.client_address[0]

                if is_rate_limited(ip):
                    self._json_error(403, 'Too many login attempts. Please try again in 15 minutes.')
                    return

                if not email or not password:
                    self._json_error(400, 'Email and password are required.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT id, name, password_hash, salt, provider, is_verified, subscription_plan FROM users WHERE email = ?', (email,))
                user = c.fetchone()
                
                if not user:
                    conn.close()
                    record_login_attempt(ip, False)
                    self._json_error(400, 'Invalid email or password.')
                    return

                user_id, name, db_hash, salt, provider, is_verified, plan = user
                if provider != 'email':
                    conn.close()
                    record_login_attempt(ip, False)
                    self._json_error(400, 'Please login using Google.')
                    return

                test_hash, _ = hash_password(password, salt)
                if test_hash != db_hash:
                    conn.close()
                    record_login_attempt(ip, False)
                    self._json_error(400, 'Invalid email or password.')
                    return

                if not is_verified:
                    verify_token = secrets.token_hex(32)
                    c.execute('UPDATE users SET verification_token = ? WHERE id = ?', (verify_token, user_id))
                    conn.commit()
                    conn.close()
                    verify_link = f"http://localhost:8000/api/auth/verify-email?token={verify_token}"
                    print("\n" + "="*80)
                    print(f"[EMAIL SIMULATION] Resending verification email to: {sanitize_log(email)}")
                    print(f"Verify Account Link: {verify_link}")
                    print("="*80 + "\n")
                    
                    self.send_response(400)
                    body = json.dumps({
                        'errors': [{'title': 'Please verify your email address. A new link has been sent to your email.'}],
                        'verifyLink': verify_link
                    }).encode('utf-8')
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return

                record_login_attempt(ip, True)
                token = secrets.token_hex(32)
                now = int(time.time())
                c.execute('INSERT INTO sessions (token, user_id, last_activity, created_at) VALUES (?, ?, ?, ?)', (token, user_id, now, now))
                conn.commit()
                conn.close()

                response_body = json.dumps({
                    'token': token,
                    'user': { 'id': user_id, 'name': name, 'email': email, 'plan': plan, 'provider': provider }
                }).encode('utf-8')

                self.send_response(200)
                self.send_header('Set-Cookie', f'session_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600')
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/google-login':
                name = data.get('name', '').strip()
                email = data.get('email', '').strip().lower()
                google_id = data.get('googleId', '').strip()

                if not email or not google_id:
                    self._json_error(400, 'Invalid Google credentials.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT id, name, provider, subscription_plan FROM users WHERE email = ?', (email,))
                user = c.fetchone()

                if user:
                    user_id, db_name, provider, plan = user
                else:
                    user_id = str(uuid.uuid4())
                    plan = 'Free'
                    provider = 'google'
                    now = int(time.time())
                    c.execute('''
                        INSERT INTO users (id, name, email, provider, is_verified, created_at)
                        VALUES (?, ?, ?, 'google', 1, ?)
                    ''', (user_id, name, email, now))
                    conn.commit()

                token = secrets.token_hex(32)
                now = int(time.time())
                c.execute('INSERT INTO sessions (token, user_id, last_activity, created_at) VALUES (?, ?, ?, ?)', (token, user_id, now, now))
                conn.commit()
                conn.close()

                response_body = json.dumps({
                    'token': token,
                    'user': { 'id': user_id, 'name': name, 'email': email, 'plan': plan, 'provider': 'google' }
                }).encode('utf-8')

                self.send_response(200)
                self.send_header('Set-Cookie', f'session_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600')
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/me':
                user, token = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized or session expired.')
                    return

                response_body = json.dumps({ 'user': user }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/logout':
                _, token = self.get_auth_user()
                if token:
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute('DELETE FROM sessions WHERE token = ?', (token,))
                    conn.commit()
                    conn.close()

                response_body = json.dumps({ 'message': 'Logged out.' }).encode('utf-8')
                self.send_response(200)
                self.send_header('Set-Cookie', 'session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/forgot-password':
                email = data.get('email', '').strip().lower()
                if not email:
                    self._json_error(400, 'Email is required.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT id, provider FROM users WHERE email = ?', (email,))
                user = c.fetchone()
                if user:
                    user_id, provider = user
                    if provider != 'email':
                        conn.close()
                        self._json_error(400, 'Google accounts cannot reset their password.')
                        return

                    reset_token = secrets.token_hex(32)
                    expiry = int(time.time()) + 3600 # 1 hour
                    c.execute('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', (reset_token, expiry, user_id))
                    conn.commit()
                    conn.close()

                    reset_link = f"http://localhost:8000/#reset-password?token={reset_token}"
                    print("\n" + "="*80)
                    print(f"[EMAIL SIMULATION] Password reset link sent to: {sanitize_log(email)}")
                    print(f"Reset Link: {reset_link}")
                    print("="*80 + "\n")

                    response_body = json.dumps({
                        'message': 'Password reset link sent to your email.',
                        'resetLink': reset_link
                    }).encode('utf-8')
                else:
                    conn.close()
                    response_body = json.dumps({
                        'message': 'Password reset link sent to your email.'
                    }).encode('utf-8')

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/reset-password':
                token = data.get('token', '').strip()
                password = data.get('password', '')

                if not token or not password:
                    self._json_error(400, 'Token and password are required.')
                    return

                # Fix 4: validate token format before DB lookup
                if not TOKEN_RE.match(token):
                    self._json_error(400, 'Invalid or expired reset token.')
                    return

                if len(password) < 6:
                    self._json_error(400, 'Password must be at least 6 characters.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                now = int(time.time())
                c.execute('SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > ?', (token, now))
                user = c.fetchone()
                if not user:
                    conn.close()
                    self._json_error(400, 'Invalid or expired reset token.')
                    return

                user_id = user[0]
                pw_hash, salt = hash_password(password)
                c.execute('UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?', (pw_hash, salt, user_id))
                conn.commit()
                conn.close()

                response_body = json.dumps({ 'message': 'Password reset successfully.' }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/change-password':
                user, _ = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized.')
                    return

                current_password = data.get('current_password', '')
                new_password = data.get('new_password', '')

                if not current_password or not new_password:
                    self._json_error(400, 'All fields are required.')
                    return

                if len(new_password) < 6:
                    self._json_error(400, 'New password must be at least 6 characters.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT password_hash, salt, provider FROM users WHERE id = ?', (user['id'],))
                db_hash, salt, provider = c.fetchone()

                if provider != 'email':
                    conn.close()
                    self._json_error(400, 'Google users cannot change password.')
                    return

                test_hash, _ = hash_password(current_password, salt)
                if test_hash != db_hash:
                    conn.close()
                    self._json_error(400, 'Incorrect current password.')
                    return

                new_hash, new_salt = hash_password(new_password)
                c.execute('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', (new_hash, new_salt, user['id']))
                conn.commit()
                conn.close()

                response_body = json.dumps({ 'message': 'Password updated successfully.' }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/update-profile':
                user, _ = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized.')
                    return

                name = data.get('name', '').strip()
                email = data.get('email', '').strip().lower()

                if not name or not email:
                    self._json_error(400, 'Name and email are required.')
                    return

                if not re.match(r'[^@]+@[^@]+\.[^@]+', email):
                    self._json_error(400, 'Invalid email format.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT id FROM users WHERE email = ? AND id != ?', (email, user['id']))
                if c.fetchone():
                    conn.close()
                    self._json_error(400, 'Email is already taken by another user.')
                    return

                c.execute('UPDATE users SET name = ?, email = ? WHERE id = ?', (name, email, user['id']))
                conn.commit()
                conn.close()

                response_body = json.dumps({ 'message': 'Profile updated successfully.' }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/delete-account':
                user, token = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()

                if user['provider'] == 'email':
                    password = data.get('password', '')
                    c.execute('SELECT password_hash, salt FROM users WHERE id = ?', (user['id'],))
                    db_hash, salt = c.fetchone()
                    test_hash, _ = hash_password(password, salt)
                    if test_hash != db_hash:
                        conn.close()
                        self._json_error(400, 'Incorrect password. Re-authentication failed.')
                        return

                c.execute('DELETE FROM users WHERE id = ?', (user['id'],))
                conn.commit()
                conn.close()

                response_body = json.dumps({ 'message': 'Account deleted successfully.' }).encode('utf-8')
                self.send_response(200)
                self.send_header('Set-Cookie', 'session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/start-trial':
                user, _ = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized.')
                    return

                # Check if user already used trial
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT trial_started_at FROM users WHERE id = ?', (user['id'],))
                row = c.fetchone()
                if row and row[0]:
                    conn.close()
                    self._json_error(400, 'You have already used your free trial.')
                    return

                now = int(time.time())
                trial_expires = now + (TRIAL_DURATION_DAYS * 86400)
                c.execute('''
                    UPDATE users SET subscription_plan = 'Pro', plan_type = 'trial',
                    trial_started_at = ?, trial_expires_at = ?, plan_expires_at = ?
                    WHERE id = ?
                ''', (now, trial_expires, trial_expires, user['id']))
                conn.commit()
                conn.close()

                response_body = json.dumps({
                    'message': f'🎉 Your {TRIAL_DURATION_DAYS}-day free trial has started!',
                    'plan': 'Pro',
                    'plan_type': 'trial',
                    'trial_expires_at': trial_expires
                }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/auth/subscription-status':
                user, _ = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized.')
                    return

                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('''
                    SELECT subscription_plan, plan_type, trial_started_at, trial_expires_at, plan_expires_at
                    FROM users WHERE id = ?
                ''', (user['id'],))
                urow = c.fetchone()

                # Fetch order history
                c.execute('''
                    SELECT order_id, plan_type, amount, currency, status, payment_method, created_at, paid_at
                    FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
                ''', (user['id'],))
                orders = []
                for o in c.fetchall():
                    orders.append({
                        'order_id': o[0], 'plan_type': o[1], 'amount': o[2],
                        'currency': o[3], 'status': o[4], 'payment_method': o[5],
                        'created_at': o[6], 'paid_at': o[7]
                    })
                conn.close()

                plan_info = {
                    'plan': urow[0] if urow else 'Free',
                    'plan_type': urow[1] if urow else None,
                    'trial_started_at': urow[2] if urow else None,
                    'trial_expires_at': urow[3] if urow else None,
                    'plan_expires_at': urow[4] if urow else None,
                    'orders': orders
                }

                response_body = json.dumps(plan_info).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

        # ─── Payment API endpoints ─────────────────────────────────────────
        if self.path.startswith('/api/payment/'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > MAX_AUTH_BODY_SIZE:
                self._json_error(413, 'Request body too large.')
                return
            post_data = self.rfile.read(content_length)

            if self.path == '/api/payment/create-order':
                user, _ = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Please sign in to purchase a subscription.')
                    return

                if not CASHFREE_CLIENT_ID or not CASHFREE_CLIENT_SECRET:
                    self._json_error(500, 'Payment gateway is not configured. Set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET environment variables.')
                    return

                try:
                    data = json.loads(post_data.decode('utf-8')) if content_length > 0 else {}
                except Exception:
                    self._json_error(400, 'Invalid JSON body.')
                    return

                plan_type = data.get('plan_type', '').strip()
                if plan_type not in PLAN_CONFIG:
                    self._json_error(400, f'Invalid plan type. Choose from: {list(PLAN_CONFIG.keys())}')
                    return

                plan = PLAN_CONFIG[plan_type]
                order_id = 'ppm-' + str(uuid.uuid4()).replace('-', '')[:24]
                host_hdr = self.headers.get('Host', f'localhost:{PORT}')
                proto = 'https' if not host_hdr.startswith('localhost') and not host_hdr.startswith('127.0.0.1') else 'http'
                return_url = f'{proto}://{host_hdr}/?payment_status=success&order_id=' + '{order_id}'

                # Create order in Cashfree
                cf_response = cashfree_create_order(
                    order_id=order_id,
                    amount=plan['amount'],
                    customer_id=user['id'],
                    customer_email=user['email'],
                    customer_phone='9999999999',
                    customer_name=user['name'],
                    return_url=return_url
                )

                if not cf_response or 'payment_session_id' not in cf_response:
                    error_msg = 'Failed to create payment order.'
                    if cf_response and 'message' in cf_response:
                        error_msg = cf_response['message']
                    self._json_error(500, error_msg)
                    return

                # Store order in DB
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                now = int(time.time())
                c.execute('''
                    INSERT INTO orders (order_id, user_id, plan_type, amount, currency, status, cashfree_order_id, payment_session_id, created_at)
                    VALUES (?, ?, ?, ?, 'INR', 'PENDING', ?, ?, ?)
                ''', (order_id, user['id'], plan_type, plan['amount'], cf_response.get('cf_order_id', order_id), cf_response['payment_session_id'], now))
                conn.commit()
                conn.close()

                response_body = json.dumps({
                    'payment_session_id': cf_response['payment_session_id'],
                    'order_id': order_id,
                    'cf_order_id': cf_response.get('cf_order_id', ''),
                    'plan': plan,
                    'plan_type': plan_type,
                    'cf_env': CASHFREE_ENV
                }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/payment/webhook':
                # Cashfree sends payment status via webhook
                raw_body = post_data.decode('utf-8')
                timestamp = self.headers.get('x-webhook-timestamp', '')
                signature = self.headers.get('x-webhook-signature', '')

                if CASHFREE_CLIENT_SECRET and signature:
                    if not verify_cashfree_webhook(timestamp, raw_body, signature):
                        print('[Webhook] ⚠️ Invalid signature, rejecting webhook.')
                        self._json_error(400, 'Invalid webhook signature.')
                        return

                try:
                    webhook_data = json.loads(raw_body)
                except Exception:
                    self._json_error(400, 'Invalid webhook payload.')
                    return

                # Extract order details
                event_type = webhook_data.get('type', '')
                order_data = webhook_data.get('data', {}).get('order', {})
                payment_data = webhook_data.get('data', {}).get('payment', {})
                order_id = order_data.get('order_id', '')
                order_status = order_data.get('order_status', '')
                cf_payment_id = payment_data.get('cf_payment_id', '')
                payment_method = ''
                pm = payment_data.get('payment_method', {})
                if pm:
                    # pm can be like {"upi": {...}} or {"card": {...}}
                    payment_method = list(pm.keys())[0] if pm else 'unknown'

                print(f'[Webhook] Event: {event_type}, Order: {sanitize_log(order_id)}, Status: {order_status}')

                if order_status == 'PAID' and order_id:
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute('SELECT user_id, plan_type, status FROM orders WHERE order_id = ?', (order_id,))
                    orow = c.fetchone()
                    if orow and orow[2] != 'PAID':  # Avoid double-processing
                        user_id, plan_type, _ = orow
                        now = int(time.time())

                        # Update order
                        c.execute('''
                            UPDATE orders SET status = 'PAID', cf_payment_id = ?, payment_method = ?, paid_at = ?
                            WHERE order_id = ?
                        ''', (str(cf_payment_id), payment_method, now, order_id))

                        # Activate plan
                        plan_cfg = PLAN_CONFIG.get(plan_type, {})
                        duration = plan_cfg.get('duration_days', 30)
                        plan_expires = now + (duration * 86400)

                        c.execute('''
                            UPDATE users SET subscription_plan = 'Pro', plan_type = ?, plan_expires_at = ?
                            WHERE id = ?
                        ''', (plan_type, plan_expires, user_id))

                        conn.commit()
                        print(f'[Webhook] ✅ Plan activated: {plan_type} for user {sanitize_log(user_id)}')
                    conn.close()

                # Always respond 200 to Cashfree
                response_body = json.dumps({'status': 'ok'}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            elif self.path == '/api/payment/verify':
                user, _ = self.get_auth_user()
                if not user:
                    self._json_error(401, 'Unauthorized.')
                    return

                try:
                    data = json.loads(post_data.decode('utf-8')) if content_length > 0 else {}
                except Exception:
                    self._json_error(400, 'Invalid JSON body.')
                    return

                order_id = data.get('order_id', '').strip()
                if not order_id:
                    self._json_error(400, 'order_id is required.')
                    return

                # Check local DB first
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute('SELECT status, plan_type FROM orders WHERE order_id = ? AND user_id = ?', (order_id, user['id']))
                orow = c.fetchone()

                if not orow:
                    conn.close()
                    self._json_error(404, 'Order not found.')
                    return

                local_status = orow[0]
                plan_type = orow[1]

                if local_status == 'PAID':
                    conn.close()
                    # Already paid via webhook
                    effective_plan = check_plan_status(user['id'])
                    response_body = json.dumps({
                        'status': 'PAID',
                        'plan': effective_plan,
                        'plan_type': plan_type,
                        'message': '🎉 Payment successful! Your Pro plan is now active.'
                    }).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(response_body)))
                    self.end_headers()
                    self.wfile.write(response_body)
                    return

                # If not yet marked PAID, poll Cashfree to confirm
                if CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET:
                    cf_order = cashfree_get_order(order_id)
                    if cf_order and cf_order.get('order_status') == 'PAID':
                        now = int(time.time())
                        plan_cfg = PLAN_CONFIG.get(plan_type, {})
                        duration = plan_cfg.get('duration_days', 30)
                        plan_expires = now + (duration * 86400)

                        c.execute("UPDATE orders SET status = 'PAID', paid_at = ? WHERE order_id = ?", (now, order_id))
                        c.execute('''
                            UPDATE users SET subscription_plan = 'Pro', plan_type = ?, plan_expires_at = ?
                            WHERE id = ?
                        ''', (plan_type, plan_expires, user['id']))
                        conn.commit()
                        conn.close()

                        response_body = json.dumps({
                            'status': 'PAID',
                            'plan': 'Pro',
                            'plan_type': plan_type,
                            'message': '🎉 Payment successful! Your Pro plan is now active.'
                        }).encode('utf-8')
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Content-Length', str(len(response_body)))
                        self.end_headers()
                        self.wfile.write(response_body)
                        return

                conn.close()
                response_body = json.dumps({
                    'status': local_status,
                    'plan': user['plan'],
                    'message': 'Payment is still being processed. Please wait a moment and try again.'
                }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
                return

            else:
                self._json_error(404, 'Payment endpoint not found.')
                return

        # Serve static files with cache-busting headers or proxy /api/removebg
        if self.path.startswith('/api/removebg'):
            content_length = int(self.headers.get('Content-Length', 0))
            # Security: limit request size to 15MB to prevent DoS via decompression bombs/out-of-memory
            if content_length > 15 * 1024 * 1024:
                self._json_error(413, 'Request payload too large (max 15MB).')
                return
            post_data = self.rfile.read(content_length)

            api_key = self.headers.get('X-Api-Key', '').strip()
            content_type = self.headers.get('Content-Type', '')

            if not api_key:
                self._json_error(400, 'Missing API Key. Please enter your Remove.bg API key.')
                return

            req = urllib.request.Request(
                'https://api.remove.bg/v1.0/removebg',
                data=post_data,
                headers={
                    'X-Api-Key': api_key,
                    'Content-Type': content_type
                },
                method='POST'
            )

            try:
                with urllib.request.urlopen(req) as response:
                    body = response.read()
                    ct = response.headers.get('Content-Type', 'image/png')
                    self.send_response(200)
                    self.send_header('Content-Type', ct)
                    self.send_header('Content-Length', str(len(body)))
                    # Fix 5: restrict CORS to localhost only
                    self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
                    self.end_headers()
                    self.wfile.write(body)

            except urllib.error.HTTPError as e:
                body = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
                self.end_headers()
                self.wfile.write(body)

            except Exception as e:
                self._json_error(500, 'An error occurred processing the request.')
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        # Fix 5: restrict CORS to localhost only
        self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Api-Key, Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _json_error(self, code, message):
        body = json.dumps({'errors': [{'title': message}]}).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
        self.end_headers()
        self.wfile.write(body)

    def send_response(self, code, message=None):
        super().send_response(code, message)
        # Cache-busting headers
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # Note: COOP/COEP headers removed intentionally — @imgly/background-removal
        # uses standard WASM (not SharedArrayBuffer), and these headers block
        # cross-origin model downloads from staticimgly.com CDN.
        # Fix 2: HTTP Security Headers (OWASP recommended) — emitted in send_response
        # so they appear on ALL responses (static files, API, errors).
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
        self.send_header(
            'Content-Security-Policy',
            "default-src 'self'; "
            "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://www.google.com https://www.googletagservices.com https://sdk.cashfree.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net; "
            "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://unpkg.com https://staticimgly.com https://*.staticimgly.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.cdn.hf.co https://*.aws.cdn.hf.co https://*.amazonaws.com https://*.cloudfront.net https://pagead2.googlesyndication.com https://*.cashfree.com https://sandbox.cashfree.com https://api.cashfree.com; "
            "worker-src 'self' blob:; "
            "frame-src 'self' https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com https://*.cashfree.com; "
            "base-uri 'self'; "
            "form-action 'self';"
        )

    def end_headers(self):
        super().end_headers()




    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")

socketserver.TCPServer.allow_reuse_address = True

print(f"Server running at http://localhost:{PORT}")
print("Press Ctrl+C to stop.\n")

with socketserver.TCPServer(("", PORT), CombinedHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        sys.exit(0)
