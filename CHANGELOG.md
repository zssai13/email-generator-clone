# Changelog

All notable changes to the Email Generator project are documented here. This file helps new Claude sessions understand the project state and recent work.

---

## [2026-01-04] - Tab 3: Text Email Generator

### Session Summary
Implemented Tab 3 "Text Email Generator" - a new feature for generating plain text emails using GPT-5.2 models with RAG-style business research and email guidelines as context.

### Added
- `app/api/generate-text-email/route.js` - New API endpoint using OpenAI's Responses API for GPT-5.2/GPT-5.2 Pro
- `tab3progress.md` - Implementation plan and documentation for Tab 3

### Changed
- `app/page.jsx` - Added Tab 3 with:
  - New state variables for text email generation
  - Model selector (GPT-5.2, GPT-5.2 Pro)
  - Two MD file upload handlers (Business Info, Email Guidelines)
  - System Prompt and User Prompt text areas
  - Gmail-style email preview component
  - Copy/download functionality for text output
  - Token/cost/time tracking display
- Tab 2 renamed from "New Feature" to "Template-Based"

### Technical Notes
- **API Format**: Uses OpenAI's new Responses API (`client.responses.create`) instead of Chat Completions
  - `input` instead of `messages`
  - `max_output_tokens` instead of `max_tokens`
  - `response.output_text` for output
- **Models**: `gpt-5.2` and `gpt-5.2-pro` (must be available in OpenAI account)
- **File Validation**: Both MD files are required, validates `.md` extension and non-empty content
- **Cost Calculation**: Uses placeholder pricing until official GPT-5.2 pricing released

### Known Issues
- GPT-5.2 models must be available in your OpenAI account (may show model error if not)
- Cost calculation uses placeholder values

### Current State
- **Status**: Tab 3 fully implemented, build passing
- **Dev Server**: `npm run dev` → http://localhost:5000
- **Tabs**: 3 tabs now available (Email Generator, Template-Based, Text Email Generator)

---

## [2026-01-04] - Local Development Setup

### Session Summary
Set up local development environment and verified the app runs correctly outside of Vercel.

### Added
- `.env.local` - Environment file for local API keys (git-ignored)
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  OPENAI_API_KEY=sk-...
  ```
- `.claude/skills/save-progress.md` - Skill to quickly save session progress
- `CHANGELOG.md` - This file for tracking session work

### Verified
- App runs locally at `http://localhost:5000`
- Next.js correctly loads `.env.local` for environment variables
- Same environment variable pattern works for both local and Vercel deployment

### Technical Notes
- **Port**: Dev server runs on port 5000 (configured in `package.json`)
- **Environment Loading**: Next.js auto-loads `.env.local` - shows "Environments: .env.local" on startup
- **API Key Handling**:
  - `/api/generate/route.js` uses implicit Anthropic SDK env loading
  - `/api/generate-template/route.js` uses explicit lazy initialization with clear error messages

### Known Issues
- Minor: `/api/generate-template/route.js` has a UTF-8 BOM character at line 1 (harmless)
- The `/api/generate/route.js` could benefit from explicit API key validation like the template route

### Current State
- **Status**: Running locally, ready for development
- **Dev Server**: `npm run dev` → http://localhost:5000
- **Dependencies**: All installed (123 packages)

---

## How to Continue

1. **Start dev server**: `npm run dev`
2. **API Keys**: Already configured in `.env.local`
3. **Test**: Visit http://localhost:5000

## Architecture Reference

See `.claude/docs/ARCHITECTURE.md` for full technical documentation.

## Quick Commands

```bash
npm install      # Install dependencies
npm run dev      # Start dev server (port 5000)
npm run build    # Production build
npm start        # Start production server
```
