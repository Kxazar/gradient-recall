import { createClient } from "@supabase/supabase-js";

function tokenize(text) {
  return [...new Set((text.toLowerCase().match(/[0-9a-zа-яё_-]+/giu) || []).filter((token) => token.length >= 3))];
}

function formatRelativeTimestamp(timestamp) {
  if (!timestamp) {
    return "No activity yet";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function scoreRow(row, tokens, index) {
  const haystack = row.content.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  }

  if (!tokens.length) {
    score += 0.25;
  }

  if (row.role === "user") {
    score += 0.35;
  }

  score += Math.max(0, 1.2 - index * 0.03);
  return score;
}

function buildProfile(rows, totalCount, userId) {
  const threadCount = new Set(rows.map((row) => row.thread_id).filter(Boolean)).size;
  const userRows = rows.filter((row) => row.role === "user");
  const latestActivity = rows[0]?.created_at || "";
  const latestUserNote = userRows[0]?.content ? userRows[0].content.slice(0, 96) : "";
  const stats = {
    storedMessages: totalCount,
    threadsSeen: threadCount,
    latestActivity,
    latestUserNote
  };

  return {
    user_bio: totalCount
      ? `Cloud memory is enabled for ${userId}. Stored ${totalCount} messages across ${threadCount || 1} thread${threadCount === 1 ? "" : "s"}.`
      : `Cloud memory is enabled for ${userId}, but nothing has been stored yet.`,
    stats,
    insights: [
      `User ID: ${userId}`,
      `Stored messages: ${totalCount}`,
      `Threads seen: ${threadCount}`,
      `Latest activity: ${formatRelativeTimestamp(latestActivity)}`,
      latestUserNote ? `Latest user note: ${latestUserNote}` : "Latest user note: none yet"
    ]
  };
}

export function createSupabaseMemoryStore({
  url,
  key,
  userId = "local-demo-user",
  tableName = "gradient_memories",
  lookback = 120,
  recallLimit = 5
}) {
  const supabase = url && key
    ? createClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      })
    : null;

  function resolveUserId(overrideUserId) {
    return (overrideUserId || userId || "local-demo-user").trim();
  }

  async function fetchRecentRows(limit = lookback, overrideUserId) {
    if (!supabase) {
      return [];
    }

    const resolvedUserId = resolveUserId(overrideUserId);

    const { data, error } = await supabase
      .from(tableName)
      .select("id, thread_id, role, content, created_at")
      .eq("user_id", resolvedUserId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  }

  async function fetchCount(overrideUserId) {
    if (!supabase) {
      return 0;
    }

    const resolvedUserId = resolveUserId(overrideUserId);

    const { count, error } = await supabase
      .from(tableName)
      .select("*", { count: "exact", head: true })
      .eq("user_id", resolvedUserId);

    if (error) {
      throw new Error(error.message);
    }

    return count || 0;
  }

  return {
    isConfigured() {
      return Boolean(supabase);
    },

    getUserId(overrideUserId) {
      return resolveUserId(overrideUserId);
    },

    async search(query, overrideUserId) {
      if (!supabase) {
        return {
          user_bio: "",
          insights: [],
          memories: []
        };
      }

      const resolvedUserId = resolveUserId(overrideUserId);
      const [rows, totalCount] = await Promise.all([fetchRecentRows(lookback, resolvedUserId), fetchCount(resolvedUserId)]);
      const tokens = tokenize(query);
      const ranked = rows
        .map((row, index) => ({
          row,
          score: scoreRow(row, tokens, index)
        }))
        .filter((entry) => tokens.length === 0 || entry.score > 1.1)
        .sort((left, right) => right.score - left.score);

      const selected = (ranked.length ? ranked : rows.map((row, index) => ({ row, score: scoreRow(row, [], index) })))
        .slice(0, recallLimit)
        .map(({ row, score }) => ({
          memory: row.content,
          type: "conversation_turn",
          role: row.role,
          thread_id: row.thread_id,
          created_at: row.created_at,
          score: Number(score.toFixed(2))
        }));

      return {
        ...buildProfile(rows, totalCount, resolvedUserId),
        memories: selected
      };
    },

    async storeConversation({ threadId, messages, userId: overrideUserId }) {
      if (!supabase) {
        return null;
      }

      const resolvedUserId = resolveUserId(overrideUserId);

      const rows = messages
        .filter((message) => message && typeof message.content === "string")
        .map((message) => ({
          user_id: resolvedUserId,
          thread_id: threadId || "default-thread",
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content.trim()
        }))
        .filter((message) => message.content.length > 0);

      if (!rows.length) {
        return null;
      }

      const { data, error } = await supabase.from(tableName).insert(rows).select("id");

      if (error) {
        throw new Error(error.message);
      }

      return data || [];
    },

    async getProfile(overrideUserId) {
      if (!supabase) {
        return null;
      }

      const resolvedUserId = resolveUserId(overrideUserId);
      const [rows, totalCount] = await Promise.all([fetchRecentRows(12, resolvedUserId), fetchCount(resolvedUserId)]);

      return {
        ...buildProfile(rows, totalCount, resolvedUserId),
        recent_memories: rows.slice(0, 5).map((row) => ({
          role: row.role,
          content: row.content,
          created_at: row.created_at,
          thread_id: row.thread_id
        }))
      };
    }
  };
}
