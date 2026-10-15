# Tennis Performance Tracker & Journal: Project Blueprint

## 1. Executive Summary & Vision
A streamlined tennis performance tracking app built for players and coaches to log actionable data with minimal friction on the court. 

Unlike traditional stat trackers that demand high cognitive load and complex point charting, this app prioritizes **speed, low latency, and tactile muscle memory** through two primary modes:
1. **Match Charter Mode:** A spectator or coach tracks winners, unforced errors, forced errors, and faults between points (20–25s window).
2. **Practice Journal Mode:** A player on court quickly records self-evaluations during short water breaks (≤90s) using a **LAMP AAC-inspired motor-planning interface** (fixed screen zones, rapid category narrowing, and emoji ratings).

---

## 2. The Core Dual Modes

### Mode 1: Match Charter (Point-by-Point Tracking)
* **Target User:** Coach, parent, teammate, or spectator watching a match.
* **Timing Constraint:** 15–25 seconds between points.
* **Tap Budget:** Maximum 2 to 3 taps per point.
* **Data Captured:**
  * Point Winner (`My Player` vs `Opponent`)
  * Shot Category (`Serve`, `Return`, `Forehand`, `Backhand`, `Volley`, `Overhead`, `Drop Shot`, `Slice`)
  * Outcome (`Winner`, `Unforced Error`, `Forced Error`, `Ace`, `Double Fault`)
  * Direction / Context (`Crosscourt`, `Down the Line`, `Net`, `Long`, `Wide`)

### Mode 2: Practice Journal (AAC Motor Planning)
* **Target User:** Player during drills or practice sessions.
* **Inspiration:** **LAMP AAC (Language Acquisition through Motor Planning)**.
  * *Core Principle:* Buttons never move. Muscle memory dictates navigation rather than visual scanning of long lists.
  * *Hierarchy:* Category -> Sub-type -> Feeling/Rating.
* **Timing Constraint:** < 5 seconds per entry during a 60–90 second water break.
* **Tap Flow (≤ 3 Taps):**
  1. **Zone 1 (Shot):** Top-left grid (e.g., `[Forehand]`, `[Backhand]`, `[Serve]`, `[Volley]`).
  2. **Zone 2 (Context / Drill):** Fixed sub-grid (e.g., `[Crosscourt Rally]`, `[Inside-Out]`, `[Approach]`, `[Return]`).
  3. **Zone 3 (Rating):** Fixed emoji buttons (`🔥 Peak`, `👍 Solid`, `⚠️ Inconsistent`, `🛑 Broken`) + optional tag (`Footwork`, `Timing`, `Spin`, `Depth`).

---

## 3. Recommended Architecture & Tech Stack

Modern full-stack architecture dividing responsibilities according to language strengths:

```
┌─────────────────────────────────────────────────────────────┐
│                 Client Layer (Mobile / PWA)                 │
│  - JavaScript / TypeScript (React / Svelte / Next.js)       │
│  - Tailored for touch devices, zero input latency           │
│  - Fixed AAC motor layouts & offline local storage          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / REST API (JSON)
┌──────────────────────────────▼──────────────────────────────┐
│                    Backend API & Data Layer                 │
│  - Python (FastAPI)                                         │
│  - SQLite (MVP local) -> PostgreSQL                         │
│  - Session management, match logs, CRUD operations          │
└──────────────────────────────┬──────────────────────────────┘
                               │ Analytical Pipelines
┌──────────────────────────────▼──────────────────────────────┐
│                  Deep Analytics & Modeling                  │
│  - Julia (Numerical simulations, Markov point chains)       │
│  - Python (Pandas/Polars for aggregations & summaries)      │
└─────────────────────────────────────────────────────────────┘
```

### Why this combination?
1. **Frontend (JavaScript / TypeScript):**
   * Mobile touch responsiveness and sub-second feedback require a client-side reactive framework.
   * Delivered as a **Progressive Web App (PWA)**: installable directly to the phone home screen without App Store / Play Store friction.
2. **Backend (Python / FastAPI):**
   * Python is your strongest language.
   * FastAPI gives you automatic OpenAPI docs, high performance, and rapid prototyping with Pydantic schemas.
3. **Analytics (Julia):**
   * Julia can be plugged in when you want advanced statistical simulation (e.g., Markov transition matrices for point likelihood, Monte Carlo match predictions, serve placement optimization).
   * Aggregations (e.g., win percentages) can start simply in Python.

---

## 4. Engineering Roadmap

### Phase 1: Domain Modeling & Schemas
* Define core entities: `Player`, `Session` (Match vs. Practice), `PointEvent`, `PracticeLog`.
* Write Python Pydantic models and SQLite table definitions.

### Phase 2: UX Wireframe & Motor Planning Layout
* Prototype the fixed-grid layout for the AAC Practice Journal.
* Ensure button hit targets are large (≥ 48x48px) and touch zones are strictly static.

### Phase 3: Minimal Viable Product (MVP)
* Stand up FastAPI backend with basic CRUD endpoints.
* Build the Practice Journal frontend first (fastest to test yourself during your own training).
* Implement local caching (IndexedDB/LocalStorage) so offline court sessions don't lose data.

### Phase 4: Match Charter Mode
* Implement match scoring state machine (points, games, sets, tiebreaks).
* Build the rapid 2-tap point conclusion interface for spectators.

### Phase 5: Stats Dashboard & Julia Analytics
* Build summary reports: "Session Highlights", "Error Hotspots", "Shot Reliability Index".
* Export session data into Julia scripts for Markov chain analysis and probabilistic match modeling.
