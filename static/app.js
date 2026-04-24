/* ─────────────────────────────────────────────────────────
   Socrates — App Logic (app.js)
   Handles: session management, API calls, UI rendering,
   speech input, belief state display, KaTeX math.
───────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────
const STATE = {
  topic: "",
  messages: [],          // [{role, content}]
  consecutiveCorrect: 0,
  complexityLevel: 1,
  turns: 0,
  isLoading: false,
  sidebarOpen: true,
  speechRecognition: null,
  isRecording: false,
  showMonologue: false,
};

function saveState() {
  localStorage.setItem("socrates_session", JSON.stringify({
    topic: STATE.topic,
    messages: STATE.messages,
    consecutiveCorrect: STATE.consecutiveCorrect,
    complexityLevel: STATE.complexityLevel,
    turns: STATE.turns
  }));
}

function loadState() {
  const saved = localStorage.getItem("socrates_session");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.topic && data.messages.length > 0) {
        STATE.topic = data.topic;
        STATE.messages = data.messages;
        STATE.consecutiveCorrect = data.consecutiveCorrect || 0;
        STATE.complexityLevel = data.complexityLevel || 1;
        STATE.turns = data.turns || 0;

        showScreen("screen-chat");
        $("chat-topic-label").textContent = STATE.topic;
        $("messages-inner").innerHTML = "";

        // Replay messages
        STATE.messages.forEach(m => {
          const role = m.role === "user" ? "user" : "ai";
          addMessageBubble(role, m.content, m.meta || {});
        });

        // Update sidebars
        updateStat("stat-correct", STATE.consecutiveCorrect);
        updateStat("stat-complexity", STATE.complexityLevel);
        updateStat("stat-turns", STATE.turns);
        updateComplexityBar(STATE.complexityLevel);

        // If the last message was AI, we can guess the belief state or just leave it since we didn't persist it.
      }
    } catch (e) {}
  }
}

// ── DOM refs ───────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Screen Management ──────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

// ── Topic Selection ────────────────────────────────────
function setTopic(t) {
  $("topic-input").value = t;
  $("topic-input").focus();
}

async function startSession() {
  const topic = $("topic-input").value.trim();
  if (!topic) {
    $("topic-input").focus();
    $("topic-input").classList.add("shake");
    setTimeout(() => $("topic-input").classList.remove("shake"), 500);
    return;
  }

  STATE.topic = topic;
  STATE.messages = [];
  STATE.consecutiveCorrect = 0;
  STATE.complexityLevel = 1;
  STATE.turns = 0;
  saveState();

  // Switch screen
  showScreen("screen-chat");
  $("chat-topic-label").textContent = topic;
  $("messages-inner").innerHTML = "";

  // Check API health
  try {
    const h = await fetch("/health");
    const data = await h.json();
    $("api-status-dot").className = "status-dot " + (data.api_configured ? "ok" : "error");
    if (!data.api_configured) {
      showError("⚠️  GEMINI_API_KEY not set in .env — responses will fail.");
    }
  } catch (_) {}

  // Fetch opening question
  setLoading(true);
  addTypingIndicator();

  try {
    const res = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    const data = await res.json();
    removeTypingIndicator();
    handleAIResponse(data);
    saveState();
  } catch (err) {
    removeTypingIndicator();
    showError(err.message || "Failed to start session.");
    addSystemMessage("⚠️ Could not connect to the AI. Check your API key in .env and restart the server.");
  } finally {
    setLoading(false);
  }
}

function newSession() {
  STATE.messages = [];
  STATE.topic = "";
  saveState();
  showScreen("screen-landing");
  $("topic-input").value = "";
  resetSidebarPanels();
  $("screen-mastery").classList.remove("active");
}

// ── Message Sending ────────────────────────────────────
async function sendMessage() {
  if (STATE.isLoading) return;
  const textarea = $("user-input");
  const text = textarea.value.trim();
  if (!text) return;

  textarea.value = "";
  autoResize(textarea);

  // Add user message to state & UI
  STATE.messages.push({ role: "user", content: text, meta: {} });
  STATE.turns++;
  addMessageBubble("user", text);
  updateStat("stat-turns", STATE.turns);
  saveState();

  // Send to API
  setLoading(true);
  $("btn-send").disabled = true;
  addTypingIndicator();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: STATE.topic,
        messages: STATE.messages,
        consecutive_correct: STATE.consecutiveCorrect,
        complexity_level: STATE.complexityLevel,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    const data = await res.json();
    removeTypingIndicator();
    handleAIResponse(data);
    saveState();
  } catch (err) {
    removeTypingIndicator();
    showError(err.message || "Request failed.");
  } finally {
    setLoading(false);
    $("btn-send").disabled = false;
    textarea.focus();
  }
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Handle AI Response ─────────────────────────────────
function handleAIResponse(data) {
  const prevComplexity = STATE.complexityLevel;

  // Update state
  STATE.consecutiveCorrect = data.consecutive_correct ?? STATE.consecutiveCorrect;
  STATE.complexityLevel     = data.complexity_level ?? STATE.complexityLevel;

  // Add AI message to history (only the response text)
  const responseText = data.response || "(No response)";
  const meta = {
    taxonomy: data.taxonomy_category,
    frustration: data.frustration_detected,
    internalNote: data.internal_note
  };
  STATE.messages.push({ role: "assistant", content: responseText, meta });

  // Level-up banner
  if (STATE.complexityLevel > prevComplexity) {
    addLevelUpBanner(STATE.complexityLevel);
  }

  // Render message
  addMessageBubble("ai", responseText, meta);

  // Update sidebar panels
  updateBeliefState(data.belief_state || {});
  updateTaxonomyPanel(data.taxonomy_category);
  updateStat("stat-correct", STATE.consecutiveCorrect);
  updateStat("stat-complexity", STATE.complexityLevel);
  updateStat("stat-frustration", data.frustration_detected ? "😤" : "😊");
  updateComplexityBar(STATE.complexityLevel);

  // Scroll
  scrollToBottom();

  // Re-render math
  if (window.renderMathInElement) {
    renderMathInElement($("messages-inner"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$",  right: "$",  display: false },
      ],
      throwOnError: false,
    });
  }

  // Trigger mastery if complexity hits 5
  if (STATE.complexityLevel >= 5) {
    triggerMastery();
  }
}

async function triggerMastery() {
  showScreen("screen-mastery");
  
  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: STATE.topic,
        messages: STATE.messages,
        final_complexity: STATE.complexityLevel,
        turns: STATE.turns
      }),
    });
    const data = await res.json();
    
    $("mastery-content").innerHTML = `
      <div class="mastery-score">${data.mastery_score}%</div>
      <div class="mastery-badge">${data.badge}</div>
      <p class="mastery-desc">${data.summary}</p>
      
      <div class="mastery-lists">
        <div class="mastery-list-col">
          <h4>Strengths</h4>
          <ul>${(data.strengths || []).map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
        <div class="mastery-list-col">
          <h4>Misconceptions Resolved</h4>
          <ul>${(data.misconceptions_resolved || []).map(m => `<li>${m}</li>`).join('')}</ul>
        </div>
      </div>
      
      <div class="mastery-next">
        <h4>Next Topics to Explore:</h4>
        <div class="topic-suggestions" style="justify-content:center;">
          ${(data.recommended_next_topics || []).map(t => `<button class="chip" onclick="setTopic('${t.replace(/'/g, "\\'")}')">${t}</button>`).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    $("mastery-content").innerHTML = `<p>Mastery achieved! (Report generation failed).</p>`;
  }
}

// ── UI Rendering Helpers ───────────────────────────────
function addMessageBubble(role, text, meta = {}) {
  const container = $("messages-inner");
  const div = document.createElement("div");
  div.className = `msg ${role}`;

  const avatar = role === "ai" ? "∂" : "U";
  const name   = role === "ai" ? "Socrates" : "You";
  const time   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const isBridgeHint = meta.frustration === true;
  const bubbleClass  = isBridgeHint ? "msg-bubble bridge-hint" : "msg-bubble";

  // Inline taxonomy tag for AI messages
  let taxonomyTag = "";
  if (role === "ai" && meta.taxonomy && meta.taxonomy !== "CORRECT") {
    const info = TAXONOMY_INFO[meta.taxonomy] || {};
    taxonomyTag = `<div class="msg-taxonomy-tag ${info.cls || ""}" style="background:${info.bg};color:${info.color}">
      ${info.icon} ${info.label}
    </div>`;
  }
  if (role === "ai" && meta.taxonomy === "CORRECT") {
    taxonomyTag = `<div class="msg-taxonomy-tag" style="background:rgba(52,211,153,0.12);color:#34d399">✓ Correct reasoning</div>`;
  }

  let monologueHtml = "";
  if (role === "ai" && meta.internalNote) {
    monologueHtml = `<div class="msg-monologue" style="display: ${STATE.showMonologue ? 'block' : 'none'}">
      <strong>Socrates' thought:</strong> ${meta.internalNote}
    </div>`;
  }

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">${name}</span>
        <span class="msg-time">${time}</span>
        ${isBridgeHint && role === "ai" ? '<span style="font-size:0.72rem;color:var(--accent-amber)">💡 Bridge Hint</span>' : ""}
      </div>
      ${monologueHtml}
      <div class="${bubbleClass}">${formatText(text)}${taxonomyTag}</div>
    </div>`;

  container.appendChild(div);
  scrollToBottom();
}

function addTypingIndicator() {
  const container = $("messages-inner");
  const div = document.createElement("div");
  div.className = "msg ai";
  div.id = "typing-indicator";
  div.innerHTML = `
    <div class="msg-avatar">∂</div>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-name">Socrates</span></div>
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  container.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = $("typing-indicator");
  if (el) el.remove();
}

function addSystemMessage(text) {
  const container = $("messages-inner");
  const div = document.createElement("div");
  div.style.cssText = "text-align:center;color:var(--text-muted);font-size:0.82rem;padding:8px 0;";
  div.textContent = text;
  container.appendChild(div);
  scrollToBottom();
}

function addLevelUpBanner(level) {
  const container = $("messages-inner");
  const div = document.createElement("div");
  div.className = "level-up-banner";
  div.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>
    </svg>
    Complexity increased to Level ${level}/5 — let's explore deeper.`;
  container.appendChild(div);
}

// ── Sidebar Panels ─────────────────────────────────────
function updateBeliefState(belief) {
  animateUpdate("belief-knows",        belief.knows        || "—");
  animateUpdate("belief-misconception", belief.misconception || "—");
  animateUpdate("belief-gap",           belief.logic_gap    || "—");
}

function animateUpdate(id, text) {
  const el = $(id);
  if (!el) return;
  el.style.opacity = "0";
  el.style.transform = "translateY(4px)";
  setTimeout(() => {
    el.textContent = text;
    el.style.transition = "all 0.4s ease";
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  }, 150);
}

const TAXONOMY_INFO = {
  FACTUAL_GAP: {
    label: "Factual Gap",
    desc: "Missing a base term or fact. Socrates is asking a definitional question.",
    cls: "badge-gap",
    bg: "rgba(91,138,245,0.12)", color: "var(--accent-blue)",
    icon: "📖",
  },
  CALCULATION_SYNTAX_ERROR: {
    label: "Calculation Error",
    desc: "Right idea, wrong execution. Socrates is pinpointing the error.",
    cls: "badge-calc",
    bg: "rgba(251,191,36,0.12)", color: "var(--accent-amber)",
    icon: "🔢",
  },
  MENTAL_MODEL_ERROR: {
    label: "Mental Model Error",
    desc: "Applying a rule from the wrong domain. Expect a counter-example.",
    cls: "badge-model",
    bg: "rgba(248,113,113,0.12)", color: "var(--accent-red)",
    icon: "🧠",
  },
  META_QUESTION: {
    label: "Meta Question",
    desc: "Asking about the process or shifting focus.",
    cls: "badge-neutral",
    bg: "rgba(139,143,168,0.12)", color: "var(--text-secondary)",
    icon: "💬",
  },
  CORRECT: {
    label: "Correct!",
    desc: "Solid reasoning. Socrates is increasing the challenge.",
    cls: "badge-correct",
    bg: "rgba(52,211,153,0.12)", color: "var(--accent-green)",
    icon: "✓",
  },
};

function updateTaxonomyPanel(category) {
  const badge = $("taxonomy-badge");
  const desc  = $("taxonomy-desc");
  const info  = TAXONOMY_INFO[category];
  if (!info) return;

  badge.className  = `taxonomy-badge ${info.cls}`;
  badge.textContent = `${info.icon} ${info.label}`;
  desc.textContent  = info.desc;
}

function updateStat(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function updateComplexityBar(level) {
  const pct = Math.min((level / 5) * 100, 100);
  const bar = $("complexity-bar");
  if (bar) bar.style.width = pct + "%";
}

function resetSidebarPanels() {
  ["belief-knows", "belief-misconception", "belief-gap"].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = "—";
  });
  const badge = $("taxonomy-badge");
  if (badge) { badge.className = "taxonomy-badge badge-neutral"; badge.textContent = "Assessing…"; }
  $("taxonomy-desc").textContent = "";
  updateStat("stat-correct", 0);
  updateStat("stat-complexity", 1);
  updateStat("stat-turns", 0);
  updateStat("stat-frustration", "—");
  updateComplexityBar(1);
}

// ── Sidebar Toggle ─────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  STATE.sidebarOpen = !STATE.sidebarOpen;
  sidebar.classList.toggle("collapsed", !STATE.sidebarOpen);
}

function toggleMonologue() {
  STATE.showMonologue = $("monologue-toggle").checked;
  document.querySelectorAll(".msg-monologue").forEach(el => {
    el.style.display = STATE.showMonologue ? 'block' : 'none';
  });
}

function exportToMarkdown() {
  let md = `# Socratic Session: ${STATE.topic}\n\n`;
  STATE.messages.forEach(m => {
    const name = m.role === "user" ? "Student" : "Socrates";
    md += `**${name}:**\n${m.content}\n\n`;
    if (m.meta && m.meta.internalNote) {
      md += `*Socrates thought: ${m.meta.internalNote}*\n\n`;
    }
  });

  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Socrates_${STATE.topic.replace(/\\s+/g, "_")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Utilities ──────────────────────────────────────────
function scrollToBottom() {
  const scroll = $("messages-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function setLoading(val) {
  STATE.isLoading = val;
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function formatText(text) {
  if (typeof marked !== "undefined") {
    return marked.parse(text);
  }
  // Fallback
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code style='background:var(--bg-base);padding:2px 6px;border-radius:4px;font-size:0.9em'>$1</code>")
    .replace(/\n/g, "<br>");
}

function showError(msg) {
  $("error-msg").textContent = msg;
  $("error-toast").classList.remove("hidden");
  setTimeout(() => $("error-toast").classList.add("hidden"), 5000);
}

// ── Speech Recognition ─────────────────────────────────
function toggleSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Speech recognition not supported in this browser.");
    return;
  }

  if (STATE.isRecording) {
    STATE.speechRecognition?.stop();
    STATE.isRecording = false;
    $("btn-mic").classList.remove("recording");
    $("speech-status").textContent = "";
    return;
  }

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = "en-US";
  STATE.speechRecognition = rec;
  STATE.isRecording = true;
  $("btn-mic").classList.add("recording");
  $("speech-status").textContent = "🎙 Listening…";

  rec.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("");
    // Strip filler words (speech optimization per spec)
    const cleaned = transcript.replace(/\b(um|uh|like|you know|er|ah|hmm)\b/gi, "").trim();
    $("user-input").value = cleaned;
    autoResize($("user-input"));
  };

  rec.onend = () => {
    STATE.isRecording = false;
    $("btn-mic").classList.remove("recording");
    $("speech-status").textContent = "";
  };

  rec.onerror = (e) => {
    STATE.isRecording = false;
    $("btn-mic").classList.remove("recording");
    $("speech-status").textContent = "";
    showError("Mic error: " + e.error);
  };

  rec.start();
}

// ── Keyboard shortcut for topic input ─────────────────
document.addEventListener("DOMContentLoaded", () => {
  const topicInput = $("topic-input");
  if (topicInput) {
    topicInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") startSession();
    });
  }
  loadState();
});

// CSS shake animation for empty input
const style = document.createElement("style");
style.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-6px)}
    40%{transform:translateX(6px)}
    60%{transform:translateX(-4px)}
    80%{transform:translateX(4px)}
  }
  .shake { animation: shake 0.4s ease; }
`;
document.head.appendChild(style);
