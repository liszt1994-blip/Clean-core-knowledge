# Clean Core Agent UI Redesign — Design Spec
**Date:** 2026-07-07  
**Status:** Approved  
**Scope:** tool1-knowledge

---

## Overview

Redesign the current 4-Tab form-style UI into a unified conversational agent interface. The goal is to make the tool feel like a real agent rather than a question-answer form — supporting code analysis, ATC error parsing, and code rewriting in a single conversation flow.

**Core use case:** A developer finds non-compliant SAP objects in their ABAP code and needs to know how to replace them, with a rewritten code example they can copy directly.

**Constraints:**
- All LLM calls continue to go through SAP AI Core (`AICoreClient`) — no direct Anthropic API
- Existing `explain`, `classify`, `recommend`, `searchNote` logic is preserved and reused internally
- Local JSON classification data (`objectReleaseInfoLatest.json`, `objectClassifications_SAP.json`) remains the primary source; AI is fallback only

---

## Section 1: Architecture

### Frontend
Remove `IconTabBar`. Replace with a single-page chat interface:
- Top: scrollable message history (chat bubbles)
- Bottom: unified input bar with mode toggle

### Backend intent routing
New `chat` action receives user input and routes to internal handlers:

```
User input
  ├─ Natural language question  → explain
  ├─ ABAP code snippet          → analyzeCode → classify → rewriteCode
  ├─ ATC error output           → analyzeAtc  → classify → rewriteCode
  └─ Object name only           → classify + recommend
```

### Existing actions
`explain`, `classify`, `recommend`, `searchNote` are retained as internal units. They are no longer directly invoked by the user — the `chat` action orchestrates them. The `/stream/explain` SSE endpoint is retained for streaming explain-type replies.

---

## Section 2: UI Layout

```
┌─────────────────────────────────────────────────────┐
│  🤖 Clean Core Agent                        [清空]   │
│  SAP Clean Core & ATC 合规助手                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ Welcome message ───────────────────────────┐   │
│  │ 你好！我可以帮你：                            │   │
│  │ • 分析 ABAP 代码中的 Clean Core 违规         │   │
│  │ • 解读 ATC check 报错并给出修复方案           │   │
│  │ • 查询对象分级和替代 API                      │   │
│  │ • 解释 Clean Core 概念                       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [User bubble - right aligned]                      │
│  [Agent bubble - left aligned]                      │
│    └─ violation cards (per object)                  │
│    └─ [查看改写代码] [📖 详细说明] buttons           │
│    └─ code diff block (expandable, default hidden)  │
│       └─ [📋 复制代码]                              │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [</> 代码]  [⚡ ATC报错]  [💬 问题]                │
│  ┌─────────────────────────────────────────────┐   │
│  │ 在此输入问题，或粘贴代码 / ATC 报错...        │   │
│  └─────────────────────────────────────────────┘   │
│                                            [发送 ▶] │
└─────────────────────────────────────────────────────┘
```

**Interaction details:**
- User messages: right-aligned, plain text or code block
- Agent messages: left-aligned, structured content
- Violation cards: one per non-compliant object, showing tier badge (A/B/C/D with color), line number, state, recommended replacement
- Code diff: two-column (original | rewritten), monospace font, dark background, collapsed by default
- SAP Note links: auto-appended to agent reply when relevant, no separate tab needed
- Mode toggle buttons change the TextArea placeholder; backend also auto-detects intent regardless of selected mode

---

## Section 3: New Backend Actions

### `chat(message, mode, history)` → `ChatReply`
Unified entry point. Routes to internal handlers based on intent detection or explicit `mode`.

```
Returns: {
  replyType : String   // explain | violations | rewrite | note | general
  text      : String   // main reply text (markdown)
  violations: array of {
    objectName, tier, state, line, callType,
    replacement, replacementType, allSuccessors, note
  }
  rewrite: {
    original  : String
    rewritten : String
  }
  notes: array of {
    title, url, noteNumber, confidenceReason
  }
}
```

### `analyzeCode(code)` → violation array
1. AI extracts all object references from ABAP code (CALL FUNCTION, direct SELECT on tables, transaction calls, old-style class/FM usage), returning `[{ objectName, line, callType }]`
2. Each object is looked up via `ClassificationClient.lookup()` — AI fallback only for misses
3. Returns enriched violation list with tier, state, replacement info

### `analyzeAtc(atcOutput)` → violation array
1. AI parses ATC output text (any format: SE80 copy, ABAP Test Cockpit export) into `[{ objectName, errorCode, line, message }]`
2. Each object goes through the same classify + recommend pipeline as `analyzeCode`
3. `errorCode` is passed as extra context to the recommend prompt

### `rewriteCode(code, violations)` → `{ original, rewritten }`
Passes full original code + violation list + replacement info to AI. Prompt requirements:
- Business logic must remain unchanged
- Only replace non-compliant calls
- Add inline comments marking each change
- Return `{ original, rewritten }` JSON

---

## Section 4: State Management

### Frontend JSONModel structure
```json
{
  "messages": [
    {
      "id": "string",
      "role": "user | agent",
      "mode": "code | atc | question | auto",
      "text": "string",
      "replyType": "violations | explain | rewrite | note | general",
      "violations": [],
      "rewrite": null,
      "notes": [],
      "rewriteExpanded": false,
      "timestamp": "HH:mm"
    }
  ],
  "inputMode": "auto",
  "inputText": "",
  "busy": false
}
```

### Key decisions
- **No backend persistence** — history lives in frontend model only; page refresh clears it. Appropriate for a personal dev tool.
- **Multi-turn context** — `chat` receives last 6 messages as `history`. Assistant messages are summarized before being included (e.g., "Analyzed 3 violations in previous code") to avoid token overflow.
- **`rewriteExpanded` flag** — toggling "查看改写代码" sets this flag on the specific message object. No new API call needed — rewrite data is already in the message.
- **SSE streaming** — `explain`-type replies use the existing `/stream/explain` SSE endpoint. Other reply types (`violations`, `rewrite`) wait for the full response before rendering.
- **Clear conversation** — top-right "清空" button resets `messages` to initial welcome message only.

---

## Section 5: Prompt Design

### `buildIntentPrompt(message, mode)`
Lightweight call (`maxTokens: 50`). Returns:
```json
{ "intent": "code" | "atc" | "explain" | "classify" | "general" }
```
Skipped entirely when `mode` is not `"auto"`.

### `buildAnalyzeCodePrompt(code)`
Instructs AI to scan ABAP code and return all potentially non-compliant object references as structured JSON. Output feeds into existing `ClassificationClient.lookup()` — no redundant AI calls for objects found in local JSON.

### `buildAnalyzeAtcPrompt(atcOutput)`
Handles any ATC output format. Extracts `objectName`, `errorCode`, `line`, `message` per finding. Uses same classify pipeline as code analysis.

### `buildRewriteCodePrompt(code, violations)`
Input: original code + violation list with replacement details.  
Requirements enforced in prompt:
1. Preserve business logic exactly
2. Replace only non-compliant calls
3. Add `"// Clean Core: replaced X with Y"` comment at each change
4. Return `{ "original": "...", "rewritten": "..." }` — no markdown fences

### Multi-turn history assembly
Last 6 messages assembled into AI Core messages array:
```
[system], [user: msg1], [assistant: summary1], [user: msg2], [assistant: summary2], ...
```
Violation/rewrite assistant turns are summarized to ~1 sentence before inclusion.

---

## Files Changed

| File | Change |
|------|--------|
| `srv/knowledge-service.cds` | Add `chat`, `analyzeCode`, `analyzeAtc`, `rewriteCode` actions |
| `srv/knowledge-service.js` | Implement 4 new action handlers; existing handlers unchanged |
| `srv/prompts.js` | Add `buildIntentPrompt`, `buildAnalyzeCodePrompt`, `buildAnalyzeAtcPrompt`, `buildRewriteCodePrompt` |
| `app/knowledge/webapp/view/App.view.xml` | Replace IconTabBar with chat layout |
| `app/knowledge/webapp/controller/App.controller.js` | Rewrite for chat model; retain SSE streaming logic |
| `server.js` | No changes needed |
| `src/aicore-client.js` | No changes needed |
| `src/classification-client.js` | No changes needed |

---

## Out of Scope

- Persistent conversation history (no DB, no localStorage)
- User authentication / multi-user sessions
- ABAP syntax highlighting in the code diff
- Direct SAP system connection (no RFC/BAPI call to read code from system)
