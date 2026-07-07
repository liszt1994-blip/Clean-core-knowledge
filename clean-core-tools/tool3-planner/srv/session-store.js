// In-memory session store for planner sessions
const sessions = new Map();

function createSession(sessionId, data) {
  sessions.set(sessionId, { ...data, plan: null });
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (session) {
    sessions.set(sessionId, { ...session, ...updates });
  }
}

module.exports = { createSession, getSession, updateSession };
