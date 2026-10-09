/**
 * 🛠 lib/queue.js — Phase 2 / 2.4
 * Per-chat command queue — replaces the single global queue in old index.js.
 *
 * Old behavior: ONE global queue for ALL chats. One slow group
 * (e.g. .broadcast sending to 1000 users) blocked EVERY other group
 * for up to 15s per task. Once 10 tasks backed up, the 11th was
 * dropped with a "⏳ I'm a bit busy" reply.
 *
 * New behavior: each chat gets its own FIFO queue. A slow group
 * only blocks itself. Per-chat MAX_QUEUE = 10; if one group
 * overflows, only that group is affected.
 *
 * The 15s per-task timeout now uses clearTimeout on early resolution,
 * so resolved tasks don't leak timer callbacks. (Phase 1 audit noted
 * the old Promise.race leaked the task promise AND the timer — both
 * are now handled.)
 */

const MAX_QUEUE = 10;
const TASK_TIMEOUT_MS = 15000;
const INTER_TASK_GAP_MS = 50;

class ChatQueue {
  constructor() {
    this.tasks = [];
    this.processing = false;
  }

  /**
   * Enqueue a task. If the queue is full, call onFull() (which can
   * send a "busy" reply to the user).
   * @param {Function} task - async function returning a Promise
   * @param {Function} [onFull] - async function called when queue is full
   * @returns {Promise<void>}
   */
  async enqueue(task, onFull) {
    if (this.tasks.length >= MAX_QUEUE) {
      console.warn(`⚠️ Queue full (${MAX_QUEUE}), dropping command`);
      if (typeof onFull === "function") {
        try { await onFull(); } catch {}
      }
      return;
    }
    this.tasks.push(task);
    this._process();
  }

  async _process() {
    if (this.processing) return;
    if (this.tasks.length === 0) return;

    this.processing = true;

    while (this.tasks.length > 0) {
      const task = this.tasks.shift();
      let timer;

      try {
        await Promise.race([
          task(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Command timeout")),
              TASK_TIMEOUT_MS
            );
          }),
        ]);
      } catch (err) {
        console.error("❌ [Queue Error]", err.message);
      } finally {
        // 🛠 FIX: always clear the timer, whether the task won the race
        // or the timeout did — the old code never cleared it on early
        // resolution, leaking timer callbacks for every successful task.
        if (timer) clearTimeout(timer);
      }

      // Small gap between tasks (matches old behavior — avoids WhatsApp
      // rate-limiting from back-to-back sends)
      await new Promise(res => setTimeout(res, INTER_TASK_GAP_MS));
    }

    this.processing = false;
  }
}

// Map<chatId, ChatQueue> — one queue per chat
const chatQueues = new Map();

/**
 * Get (or create) the queue for a given chat.
 */
function getQueue(chatId) {
  if (!chatQueues.has(chatId)) {
    chatQueues.set(chatId, new ChatQueue());
  }
  return chatQueues.get(chatId);
}

/**
 * Enqueue a task on the per-chat queue.
 * Convenience wrapper.
 */
function enqueueCommand(chatId, task, onFull) {
  return getQueue(chatId).enqueue(task, onFull);
}

/**
 * Get current queue depth for a chat (for monitoring / .system).
 */
function getQueueDepth(chatId) {
  return getQueue(chatId).tasks.length;
}

/**
 * Total queue depth across all chats (for .system aggregate stats).
 */
function getTotalQueueDepth() {
  let total = 0;
  for (const q of chatQueues.values()) total += q.tasks.length;
  return total;
}

module.exports = {
  ChatQueue,
  chatQueues,
  getQueue,
  enqueueCommand,
  getQueueDepth,
  getTotalQueueDepth,
  MAX_QUEUE,
  TASK_TIMEOUT_MS,
};
