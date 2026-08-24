import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("AZURE_TRAINING_DB_PATH", os.path.join(ROOT, "storage", "azure-training.sqlite3"))
HOST = os.environ.get("AI103_HOST", "0.0.0.0")
PORT = int(os.environ.get("AI103_PORT", "8000"))
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
DB_LOCK = threading.Lock()

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
    return salt.hex() + ":" + digest.hex()

def verify_password(password, encoded):
    try:
        salt, expected = encoded.split(":", 1)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 180_000).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS progress (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        """)
        admin = conn.execute("SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)).fetchone()
        if not admin:
            conn.execute("INSERT INTO users(username, password_hash, is_admin) VALUES (?, ?, 1)", (ADMIN_USERNAME, hash_password(ADMIN_PASSWORD)))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def json_response(self, status, payload, cookies=None):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        if cookies:
            for cookie in cookies: self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def user(self):
        token = ""
        for item in self.headers.get("Cookie", "").split(";"):
            if item.strip().startswith("azure_training_session="): token = item.strip().split("=", 1)[1]
        if not token: return None
        with DB_LOCK, db() as conn:
            row = conn.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?", (token, __import__("time").time())).fetchone()
        return dict(row) if row else None

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/storage/") or path.endswith((".sqlite", ".sqlite3", ".db")):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if path == "/api/auth/me":
            user = self.user()
            return self.json_response(200, {"authenticated": bool(user), "user": {"username": user["username"], "isAdmin": bool(user["is_admin"])} if user else None})
        if path == "/api/progress":
            user = self.user()
            if not user: return self.json_response(401, {"error": "请先登录"})
            with DB_LOCK, db() as conn:
                row = conn.execute("SELECT payload FROM progress WHERE user_id=?", (user["id"],)).fetchone()
            return self.json_response(200, json.loads(row["payload"]) if row else None)
        if path == "/api/admin/users":
            user = self.user()
            if not user or not user["is_admin"]: return self.json_response(403, {"error": "需要管理员权限"})
            with DB_LOCK, db() as conn:
                rows = conn.execute("SELECT id, username, is_admin, created_at FROM users ORDER BY id").fetchall()
            return self.json_response(200, {"users": [{"id": r["id"], "username": r["username"], "isAdmin": bool(r["is_admin"]), "createdAt": r["created_at"]} for r in rows]})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data = self.body()
        if path in ("/api/auth/login", "/api/auth/register"):
            username, password = str(data.get("username", "")).strip(), str(data.get("password", ""))
            if len(username) < 2 or len(password) < 6: return self.json_response(400, {"error": "用户名至少 2 位，密码至少 6 位"})
            with DB_LOCK, db() as conn:
                existing = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
                if path.endswith("register"):
                    if existing: return self.json_response(409, {"error": "用户名已存在"})
                    conn.execute("INSERT INTO users(username,password_hash) VALUES(?,?)", (username, hash_password(password)))
                    existing = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
                elif not existing or not verify_password(password, existing["password_hash"]):
                    return self.json_response(401, {"error": "用户名或密码错误"})
                token = secrets.token_urlsafe(32)
                conn.execute("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)", (token, existing["id"], int(__import__("time").time()) + 60 * 60 * 24 * 14))
            return self.json_response(200, {"user": {"username": existing["username"], "isAdmin": bool(existing["is_admin"])}}, [f"azure_training_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600"])
        if path == "/api/auth/logout":
            self.send_response(204); self.send_header("Set-Cookie", "azure_training_session=; Path=/; Max-Age=0"); self.end_headers(); return
        if path == "/api/progress":
            user = self.user()
            if not user: return self.json_response(401, {"error": "请先登录"})
            with DB_LOCK, db() as conn:
                conn.execute("INSERT INTO progress(user_id,payload,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP", (user["id"], json.dumps(data, ensure_ascii=False)))
            return self.json_response(200, {"ok": True})
        if path == "/api/admin/users/password":
            user = self.user()
            if not user or not user["is_admin"]: return self.json_response(403, {"error": "需要管理员权限"})
            target, password = data.get("userId"), str(data.get("password", ""))
            if len(password) < 6: return self.json_response(400, {"error": "密码至少 6 位"})
            with DB_LOCK, db() as conn:
                result = conn.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(password), target))
                if not result.rowcount: return self.json_response(404, {"error": "用户不存在"})
            return self.json_response(200, {"ok": True})
        if path == "/api/admin/users/delete":
            user = self.user()
            if not user or not user["is_admin"]: return self.json_response(403, {"error": "需要管理员权限"})
            try:
                target = int(data.get("userId"))
            except (TypeError, ValueError):
                return self.json_response(400, {"error": "用户编号无效"})
            with DB_LOCK, db() as conn:
                target_user = conn.execute("SELECT id, username, is_admin FROM users WHERE id=?", (target,)).fetchone()
                if not target_user: return self.json_response(404, {"error": "用户不存在"})
                if target_user["is_admin"]: return self.json_response(400, {"error": "不能删除管理员账号"})
                conn.execute("DELETE FROM users WHERE id=?", (target,))
            return self.json_response(200, {"ok": True, "username": target_user["username"]})
        return self.json_response(404, {"error": "接口不存在"})

if __name__ == "__main__":
    init_db()
    print(f"Azure Training Platform listening on http://localhost:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
