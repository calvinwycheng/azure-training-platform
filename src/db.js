(() => {
  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    if (response.status === 204) return null;
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "请求失败");
    return payload;
  }
  window.QuizAuth = {
    me: () => request("/api/auth/me"),
    login: (username, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
    register: (username, password) => request("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
    logout: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
    users: () => request("/api/admin/users"),
    changePassword: (userId, password) => request("/api/admin/users/password", { method: "POST", body: JSON.stringify({ userId, password }) }),
    deleteUser: userId => request("/api/admin/users/delete", { method: "POST", body: JSON.stringify({ userId }) }),
  };
  window.QuizDB = { get: key => key === "progress" ? request("/api/progress") : undefined, set: (key, value) => key === "progress" ? request("/api/progress", { method: "POST", body: JSON.stringify(value) }) : undefined };
})();
