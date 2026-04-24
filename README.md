# Socratic Misconception Mapper

An advanced, adaptive AI tutoring platform designed to facilitate Socratic dialogue. Rather than simply giving answers, this tutor builds a mental "Belief State" of the student, maps their errors to a "Misconception Taxonomy", and applies adaptive scaffolding to guide them to true mastery.

## Features

- **Cognitive Architecture**: The AI maintains a persistent state of the user's understanding, categorizing failures into specific taxonomy types (Factual Gap, Calculation Error, Mental Model Error, or Meta Question).
- **Adaptive Scaffolding & Rule of Three**: Dynamically scales the difficulty when the student successfully answers multiple questions in a row.
- **Internal Monologue Mode**: Toggle on the AI's internal reasoning to peek at how it tags misconceptions and strategizes its next question.
- **Mastery Summaries**: Upon reaching Level 5 complexity, the session concludes with a comprehensive Mastery Report detailing strengths, resolved misconceptions, and next topics to explore.
- **Seamless Markdown & Math Rendering**: Beautifully formats code blocks, bullet points, and complex mathematical formulas using KaTeX.
- **Session Export**: One-click download to export the entire session transcript to a Markdown file.
- **Multi-Model Support**: Native support for running lightning-fast via **Groq** (Llama-3.3-70b-versatile) or **Google Gemini** (Gemini-2.0-Flash).

## Quick Start

### Prerequisites
- Python 3.9+
- An API Key from [Groq](https://console.groq.com/keys) OR [Google AI Studio](https://aistudio.google.com/app/apikey)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/TinkerTechie/Socrates.git
   cd Socrates
   ```

2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up your environment variables by creating a `.env` file in the root directory:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   # Or alternatively:
   # GEMINI_API_KEY=your_gemini_api_key_here
   ```
   *(Note: The system will automatically prioritize Groq if both are provided for faster inference).*

4. Start the backend application server:
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload
   ```

5. Open your browser and navigate to `http://localhost:8080` to begin your Socratic learning session.

## Architecture Highlights
- **FastAPI Backend**: Handles routing, API endpoints, and LLM orchestration smoothly.
- **Vanilla JavaScript & CSS**: A premium, dark-mode focused UI built without heavy frameworks for maximum speed and simplicity.
- **LocalStorage State Persistence**: Never lose your chat history on a page refresh.
