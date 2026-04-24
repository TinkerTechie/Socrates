"""
Socratic Misconception Mapper — FastAPI Backend
Manages hidden Belief State, Misconception Taxonomy, and Socratic Loop.
"""

import os
import json
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from groq import Groq
from dotenv import load_dotenv

load_dotenv(override=True)

app = FastAPI(title="Socratic Misconception Mapper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── LLM Setup ──────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

PROVIDER = None
MODEL_CLIENT = None
MODEL_NAME = ""

if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
    PROVIDER = "groq"
    MODEL_CLIENT = Groq(api_key=GROQ_API_KEY)
    MODEL_NAME = "llama-3.3-70b-versatile"
elif GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
    genai.configure(api_key=GEMINI_API_KEY)
    PROVIDER = "gemini"
    MODEL_CLIENT = genai.GenerativeModel("gemini-2.0-flash")
    MODEL_NAME = "gemini-2.0-flash"

def generate_completion(prompt: str) -> str:
    """Generate a single-turn completion."""
    if PROVIDER == "groq":
        resp = MODEL_CLIENT.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=MODEL_NAME,
            response_format={"type": "json_object"}
        )
        return resp.choices[0].message.content
    else:
        return MODEL_CLIENT.generate_content(prompt).text

def generate_chat(system_prompt: str, history: list[dict], user_msg: str) -> str:
    """Generate a multi-turn chat response."""
    if PROVIDER == "groq":
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            role = "assistant" if msg["role"] == "model" else "user"
            messages.append({"role": role, "content": msg["parts"][0]})
        messages.append({"role": "user", "content": user_msg})
        
        resp = MODEL_CLIENT.chat.completions.create(
            messages=messages,
            model=MODEL_NAME,
            response_format={"type": "json_object"}
        )
        return resp.choices[0].message.content
    else:
        chat_session = MODEL_CLIENT.start_chat(
            history=[
                {"role": "user", "parts": [system_prompt]},
                {"role": "model", "parts": ['{"acknowledged": true, "ready": true}']},
                *history,
            ]
        )
        return chat_session.send_message(user_msg).text

# ─── Socratic System Prompt (Cognitive Architecture) ───────────────────────
SYSTEM_PROMPT = """You are the "Socratic Misconception Mapper." Your singular goal is to guide the student to mastery without EVER providing the direct answer.

═══════════════════════════════════════
SECTION 1: CORE OPERATIONAL LOGIC
═══════════════════════════════════════

Hidden State Tracking: For every turn, maintain a mental "Belief State" of the student:
- What they KNOW (correct understanding)
- What they THINK they know (but are wrong about — the misconception)
- The specific "Logic Gap" preventing progress

The Socratic Loop: Observe Response → Map to Misconception Taxonomy → Generate Targeted Question → Wait.

═══════════════════════════════════════
SECTION 2: MISCONCEPTION TAXONOMY
═══════════════════════════════════════

When a student fails, categorize their error into EXACTLY one type:

1. FACTUAL_GAP: They simply don't know a base term or fact.
   → Action: Ask a definitional question that leads them to discover the concept.

2. CALCULATION_SYNTAX_ERROR: They have the right idea but wrong execution.
   → Action: Ask them to "double-check the process" in a specific, targeted area.

3. MENTAL_MODEL_ERROR: They are applying a rule from one domain to another where it doesn't fit.
   → Action: Use a Reductio ad absurdum counter-example to expose the contradiction.

4. META_QUESTION: The student is asking a clarifying question about the interface, wanting to skip, or discussing the tutoring process itself.
   → Action: Answer briefly and gently guide them back to the Socratic learning path.

═══════════════════════════════════════
SECTION 3: ADAPTIVE QUESTIONING RULES
═══════════════════════════════════════

- NO YES/NO QUESTIONS: Never ask "Do you understand?" Instead ask "How would X change if Y happened?"
- QUESTION VARIETY: To check knowledge quickly, occasionally present a Multiple Choice Question (MCQ) formatted with clear A, B, C, D markdown options. This is especially useful for checking Factual Gaps.
- SCAFFOLDING: If student is struggling, zoom out to a simpler version. If thriving, zoom in to a complex edge case.
- RULE OF THREE: Never ask more than 3 questions in a row without acknowledging a correct piece of their logic.
- DIFFICULTY SCALING: If a student answers correctly multiple times, immediately increase complexity by adding a secondary variable (e.g., "Now, what if there's wind resistance?")

═══════════════════════════════════════
SECTION 4: FRUSTRATION DETECTION & BRIDGE HINTS
═══════════════════════════════════════

Signs of frustration: very short answers (< 5 words), "I don't know", "idk", "??", "help", repeating the same wrong answer.

If frustration detected → Pivot to a BRIDGE HINT: a half-answer that provides the concept but leaves the application to the student.
Example: "The key here is that energy scales with the SQUARE of velocity — so if you doubled the speed, how much more energy would that require?"

═══════════════════════════════════════
SECTION 5: SPEECH INPUT OPTIMIZATION
═══════════════════════════════════════

Spoken answers are messy. Ignore filler words ("um", "uh", "like", "you know") and focus on the CORE KEYWORDS that reveal the student's mental model.

═══════════════════════════════════════
SECTION 6: RESPONSE FORMAT (STRICT)
═══════════════════════════════════════

For EVERY response, you MUST output a valid JSON object (no markdown, no code blocks) with this exact structure:

{
  "belief_state": {
    "knows": "Brief description of what they correctly understand",
    "misconception": "The specific wrong belief or gap",
    "logic_gap": "The precise conceptual bridge they're missing"
  },
  "taxonomy_category": "FACTUAL_GAP | CALCULATION_SYNTAX_ERROR | MENTAL_MODEL_ERROR | META_QUESTION | CORRECT",
  "frustration_detected": true | false,
  "consecutive_correct": 0,
  "complexity_level": 1,
  "response": "Your Socratic question, bridge hint, or acknowledgment — this is shown to the student",
  "internal_note": "Private reasoning note (never shown to student)"
}

If taxonomy_category is CORRECT, celebrate the insight warmly then immediately pivot to a harder edge case.
The "response" field is the ONLY thing shown to the student. Make it engaging, witty, and intellectually curious.
Use markdown in "response" for math (e.g. $F=ma$, $KE=\\frac{1}{2}mv^2$) and emphasis.
"""


# ─── Data Models ────────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    topic: str
    messages: list[Message]
    consecutive_correct: int = 0
    complexity_level: int = 1

class SessionStart(BaseModel):
    topic: str

class ChatResponse(BaseModel):
    belief_state: dict
    taxonomy_category: str
    frustration_detected: bool
    consecutive_correct: int
    complexity_level: int
    response: str
    internal_note: str


# ─── Helper: Build Gemini Chat History ──────────────────────────────────────
def build_gemini_history(messages: list[Message]) -> list[dict]:
    """Convert our messages to Gemini's expected format."""
    history = []
    for msg in messages[:-1]:  # Exclude the latest user message
        role = "user" if msg.role == "user" else "model"
        history.append({"role": role, "parts": [msg.content]})
    return history


# ─── Routes ─────────────────────────────────────────────────────────────────
@app.get("/")
async def serve_frontend():
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    api_configured = bool(PROVIDER is not None)
    return {"status": "ok", "api_configured": api_configured, "model": MODEL_NAME}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not PROVIDER:
        raise HTTPException(
            status_code=503,
            detail="No API key configured. Please set GROQ_API_KEY or GEMINI_API_KEY in your .env file."
        )

    if not req.messages:
        raise HTTPException(status_code=400, detail="No messages provided.")

    latest_user_message = req.messages[-1].content

    # Detect frustration signals
    frustration_words = ["i don't know", "idk", "no idea", "help", "stuck", "???", "??", "give up"]
    is_short = len(latest_user_message.strip().split()) <= 4
    has_frustration_word = any(fw in latest_user_message.lower() for fw in frustration_words)
    frustration_hint = is_short or has_frustration_word

    # Build context-aware prompt
    context_injection = f"""
Current session context:
- Topic: {req.topic}
- Consecutive correct answers so far: {req.consecutive_correct}
- Current complexity level: {req.complexity_level} (scale 1-5)
- Frustration signals detected by client: {frustration_hint}

IMPORTANT: Output ONLY the raw JSON object. No markdown fences, no preamble.
"""

    # Build history for multi-turn
    history = build_gemini_history(req.messages)

    try:
        raw = generate_chat(SYSTEM_PROMPT + context_injection, history, latest_user_message)
        raw = raw.strip()

        # Strip potential markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        parsed = json.loads(raw)

        # Apply consecutive correct logic
        new_consecutive = req.consecutive_correct
        new_complexity = req.complexity_level
        cat = parsed.get("taxonomy_category")

        if cat == "CORRECT":
            new_consecutive += 1
            if new_consecutive >= 2 and new_complexity < 5:
                new_complexity += 1
                new_consecutive = 0
        elif cat == "META_QUESTION":
            pass # do not penalize or reset streak for meta questions
        else:
            new_consecutive = 0

        parsed["consecutive_correct"] = new_consecutive
        parsed["complexity_level"] = new_complexity

        return parsed

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"AI response parse error: {str(e)}. Raw: {raw[:200]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/start")
async def start_session(req: SessionStart):
    """Generate the opening Socratic question for a topic."""
    if not PROVIDER:
        raise HTTPException(
            status_code=503,
            detail="No API key configured. Please set GROQ_API_KEY or GEMINI_API_KEY in your .env file."
        )

    opening_prompt = f"""
{SYSTEM_PROMPT}

The student has chosen to explore the topic: "{req.topic}"

Generate the first Socratic question to probe their current understanding. 
Start with an open-ended question that will reveal their baseline mental model.
Do NOT explain the topic. Just ask a thoughtful first question.

Output ONLY the raw JSON object with these fields:
{{
  "belief_state": {{"knows": "unknown — first contact", "misconception": "unknown yet", "logic_gap": "assessing baseline"}},
  "taxonomy_category": "FACTUAL_GAP",
  "frustration_detected": false,
  "consecutive_correct": 0,
  "complexity_level": 1,
  "response": "Your opening Socratic question here",
  "internal_note": "Strategy for opening probe"
}}
"""
    try:
        raw = generate_completion(opening_prompt)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        return json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Summary / Mastery Report ────────────────────────────────────────────────
class SummaryRequest(BaseModel):
    topic: str
    messages: list[Message]
    final_complexity: int
    turns: int


@app.post("/api/summary")
async def generate_summary(req: SummaryRequest):
    """Generate a mastery summary report at the end of a session."""
    if not PROVIDER:
        raise HTTPException(status_code=503, detail="No API key configured. Please set GROQ_API_KEY or GEMINI_API_KEY in your .env file.")

    # Build a readable transcript
    transcript_lines = []
    for m in req.messages:
        role_label = "Student" if m.role == "user" else "Socrates"
        transcript_lines.append(f"{role_label}: {m.content}")
    transcript = "\n".join(transcript_lines)

    summary_prompt = f"""
You are reviewing a completed Socratic tutoring session. Analyze the conversation and produce a JSON mastery report.

Topic: {req.topic}
Total exchanges: {req.turns}
Final complexity level reached: {req.final_complexity}/5

Transcript:
{transcript}

Output ONLY a raw JSON object (no markdown fences) with this structure:
{{
  "mastery_score": <integer 0-100>,
  "summary": "2-3 sentences summarising what the student learned and how they progressed.",
  "strengths": ["strength 1", "strength 2"],
  "growth_areas": ["area 1", "area 2"],
  "misconceptions_resolved": ["misconception 1", "misconception 2"],
  "recommended_next_topics": ["topic 1", "topic 2", "topic 3"],
  "badge": "One of: Apprentice | Practitioner | Analyst | Expert | Master"
}}
"""

    try:
        raw = generate_completion(summary_prompt)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        return json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Static Files ────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")
