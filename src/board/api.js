// Browser client for /api/board/*. Every call carries the Clerk session token.
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || "error"); this.status = status; this.body = body || {}; }
}

export function makeApi(getToken, base = "/api/board") {
  async function call(method, path, body) {
    const token = await getToken();
    // One fixed endpoint, route in ?p= (see api/board.js)
    const [route, qs] = path.replace(/^\//, "").split("?");
    const res = await fetch(`${base}?p=${encodeURIComponent(route).replace(/%2F/g, "/")}${qs ? "&" + qs : ""}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new ApiError(res.status, json);
    return json;
  }
  return {
    listPlans: () => call("GET", "/plans"),
    getPlan: (id) => call("GET", `/plans/${id}`),
    getLayout: (id, since) => call("GET", `/plans/${id}/layout${since != null ? `?since=${since}` : ""}`),
    saveLayout: (id, expectedRev, state, note) => call("POST", `/plans/${id}/layout`, { expectedRev, state, note }),
    listRevisions: (id) => call("GET", `/plans/${id}/revisions`),
    getRevision: (id, rev) => call("GET", `/plans/${id}/revisions/${rev}`),
    listMembers: (id) => call("GET", `/plans/${id}/members`),
    setRole: (id, userId, role) => call("PATCH", `/plans/${id}/members/${encodeURIComponent(userId)}`, { role }),
    removeMember: (id, userId) => call("DELETE", `/plans/${id}/members/${encodeURIComponent(userId)}`),
    createInvite: (id, role) => call("POST", `/plans/${id}/invites`, { role }),
    deleteInvite: (id, token) => call("DELETE", `/plans/${id}/invites/${token}`),
    acceptInvite: (token) => call("POST", `/invites/${token}/accept`),
  };
}
