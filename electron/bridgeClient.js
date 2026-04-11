/**
 * Shared task-callback registry.
 * main.js calls resolveTask() when the extension reports back.
 * actions.js calls waitForTask() after dispatching a command.
 * No circular dependency — both ends require this module.
 */

const pending = new Map(); // taskId → { resolve, reject, timer }

function resolveTask(taskId, result) {
  const cb = pending.get(taskId);
  if (!cb) return false;
  clearTimeout(cb.timer);
  pending.delete(taskId);
  cb.resolve(result);
  return true;
}

function waitForTask(taskId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(taskId);
      reject(new Error(`Task ${taskId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(taskId, { resolve, reject, timer });
  });
}

module.exports = { resolveTask, waitForTask };
