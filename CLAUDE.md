# Email Generator

HYROS internal R&D tool for testing AI email generation approaches before production deployment.

## Session Startup

**READ `CHANGELOG.md` FIRST** - It contains recent session history, current project state, and known issues. This ensures continuity between Claude sessions.

## Quick Start

```bash
npm install
npm run dev      # http://localhost:5000
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Current Features

| Tab | Purpose |
|-----|---------|
| **Email Generator** | Create high-quality HTML templates with Claude Opus |
| **Template-Based** | Test cheaper models using HTML templates as examples |
| **Text Email Generator** | Generate plain text emails with GPT-5.2 using RAG data |

## Key Files

- `app/page.jsx` - Main UI (all 3 tabs)
- `app/api/generate/route.js` - Tab 1: Opus generation endpoint
- `app/api/generate-template/route.js` - Tab 2: Template-based endpoint
- `app/api/generate-text-email/route.js` - Tab 3: Text email endpoint (GPT-5.2)
- `tab3progress.md` - Tab 3 implementation documentation

## Deployment

Target: **Vercel** (serverless)

Constraints:
- No file system writes
- 10s function timeout (60s on Pro)
- Environment variables via Vercel dashboard

---

# Product Requirements (PRD)

## Overview

**Product**: Email Generator Testing Tool
**Owner**: HYROS
**Type**: Internal R&D Tool
**Deployment**: Vercel

## Purpose

An internal sandbox for testing AI-powered email generation approaches before deploying to HYROS's main product. The tool allows the team to:

- Experiment with different AI models and generation strategies
- Compare output quality across approaches
- Track and optimize generation costs
- Create reusable email templates

## Users

- HYROS team members (developers, marketers, product)
- Multiple concurrent users
- No external/customer access

## Key Metrics

| Metric | Why It Matters |
|--------|----------------|
| **Cost per generation** | Optimize spend before production |
| **Output quality** | Subjective review of email effectiveness |
| **Token usage** | Understand model efficiency |

## Tab 1: Email Generator (Opus)

**Purpose**: Generate high-quality "gold standard" email templates

- Input: Product URL + email count (1-4) + optional promotion text
- Model: Claude Opus 4.5 (fixed - highest quality)
- Output: Multiple email variations in different styles
- Use case: Create reference templates for Tab 2

## Tab 2: Template-Based Generator

**Purpose**: Test if cheaper models can replicate quality using templates as examples

- Input: Product URL + HTML template (upload) + custom prompt + model selection
- Models: 8 options ranging from premium to cost-optimized
- Output: Single email following template structure
- Use case: Validate cheaper approaches before production

**Available Models**:
1. Claude Opus 4.5 (highest quality)
2. Claude Sonnet 4.5 (balanced)
3. GPT-4o (high quality)
4. GPT-4o Mini (cheaper)
5. GPT-4o Extract + Mini Generate (hybrid)
6. Claude Sonnet Extract + Mini Generate (hybrid)
7. Claude Haiku Extract + Mini Generate (hybrid)
8. Manual Extract + Mini Refine + Generate (cheapest - 60-70% cost reduction)

## Future Roadmap

All future features remain **email-focused**:

| Feature | Description |
|---------|-------------|
| ~~**Text-only emails**~~ | ~~Plain text email generation (no HTML)~~ **DONE - Tab 3** |
| **Sales rep replication** | Replicate outbound sales rep writing style |
| **Additional generation methods** | New AI techniques, prompt strategies, model comparisons |

## Architecture Requirements

### Shared Infrastructure

All tabs/features must share:
- API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY)
- Model configuration patterns
- Cost calculation utilities
- UI components where applicable

### Extensibility

New features should be added as:
- New tabs in the main UI
- New API routes following existing patterns
- Reusable shared utilities

---

# Architecture

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 14.2 (App Router) |
| **Frontend** | React 18.2, Tailwind CSS 3.4 |
| **Backend** | Next.js API Routes (serverless) |
| **AI - Anthropic** | Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 |
| **AI - OpenAI** | GPT-4o, GPT-4o Mini, GPT-5.2, GPT-5.2 Pro |
| **HTML Parsing** | Cheerio 1.0 (server-side) |
| **Deployment** | Vercel (serverless) |

## Directory Structure

```
email-generator-clone/
├── app/
│   ├── api/
│   │   ├── generate/
│   │   │   └── route.js        # Tab 1: Opus generation
│   │   ├── generate-template/
│   │   │   └── route.js        # Tab 2: Template-based generation
│   │   └── generate-text-email/
│   │       └── route.js        # Tab 3: Text email generation (GPT-5.2)
│   ├── globals.css             # Tailwind imports
│   ├── layout.jsx              # Root layout
│   └── page.jsx                # Main UI (all 3 tabs)
├── .claude/
│   └── docs/
│       ├── PRD.md              # Product requirements
│       └── ARCHITECTURE.md     # Architecture details
├── CLAUDE.md                   # AI assistant reference (this file)
├── tab3progress.md             # Tab 3 implementation documentation
├── next.config.js              # Next.js configuration
├── tailwind.config.js          # Tailwind configuration
├── postcss.config.js           # PostCSS configuration
└── package.json                # Dependencies and scripts
```

## API Routes

### POST /api/generate

**Purpose**: High-quality email generation using Claude Opus (Tab 1)

**Request**:
```json
{
  "productUrl": "https://example.com/product",
  "emailCount": 2,
  "promotion": "20% off today only"
}
```

**Response**:
```json
{
  "success": true,
  "content": "<html>...</html>",
  "productData": { "title": "...", "price": "...", "images": [...] }
}
```

**Flow**:
1. Claude Opus fetches product page via tool use
2. Extracts product data (title, price, images, description)
3. Generates 2-4 email variations in different styles
4. Returns combined HTML with all variations

### POST /api/generate-template

**Purpose**: Template-based generation with model selection (Tab 2)

**Request**:
```json
{
  "productUrl": "https://example.com/product",
  "emailTemplate": "<html>template...</html>",
  "customPrompt": "Make it more casual",
  "model": "manual-extract-mini"
}
```

**Response**:
```json
{
  "success": true,
  "content": "<html>...</html>",
  "usage": {
    "inputTokens": 1500,
    "outputTokens": 800,
    "totalTokens": 2300,
    "estimatedCost": 0.004
  }
}
```

**Model Options**:
| Model ID | Description | Cost |
|----------|-------------|------|
| `claude-opus` | Claude Opus 4.5 | $$$ |
| `claude-sonnet` | Claude Sonnet 4.5 | $$ |
| `gpt-4o` | GPT-4o | $$$ |
| `gpt-4o-mini` | GPT-4o Mini | $ |
| `gpt4o-extract-mini-generate` | GPT-4o extracts, Mini generates | $$ |
| `sonnet-extract-mini-generate` | Sonnet extracts, Mini generates | $$ |
| `haiku-extract-mini-generate` | Haiku extracts, Mini generates | $ |
| `manual-extract-mini` | Cheerio extracts, Mini refines + generates | $ (cheapest) |

### POST /api/generate-text-email

**Purpose**: Plain text email generation using GPT-5.2 (Tab 3)

**Request**:
```json
{
  "businessInfo": "# Business Research markdown...",
  "emailGuidelines": "# Email Guidelines markdown...",
  "systemPrompt": "You are a sales representative...",
  "userPrompt": "Write an intro email to Sarah...",
  "model": "gpt-5.2"
}
```

**Response**:
```json
{
  "success": true,
  "content": "Subject: Quick question...\n\nHi Sarah,...",
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 400,
    "total_tokens": 1900,
    "estimated_cost_usd": 0.0025,
    "generation_time_ms": 1234
  }
}
```

**Model Options**:
| Model ID | Description |
|----------|-------------|
| `gpt-5.2` | Standard GPT-5.2 generation |
| `gpt-5.2-pro` | GPT-5.2 Pro for deeper reasoning |

**Note**: Uses OpenAI's Responses API (`client.responses.create`) instead of Chat Completions.

## Cost Calculation

Both API routes track and return token usage with cost estimates:

```javascript
// GPT-4o pricing
const GPT4O_INPUT = 0.0025 / 1000;   // per token
const GPT4O_OUTPUT = 0.010 / 1000;

// GPT-4o Mini pricing
const MINI_INPUT = 0.00015 / 1000;
const MINI_OUTPUT = 0.0006 / 1000;
```

## Product Data Extraction Strategies

1. **AI Extraction** (expensive): Claude/GPT fetches and analyzes page
2. **Hybrid** (balanced): Premium model extracts, Mini generates
3. **Manual + AI** (cheapest): Cheerio parses HTML, Mini refines

Manual extraction uses priority-based CSS selectors:
- Price: `.price`, `[data-price]`, `.product-price`, etc.
- Title: `h1`, `.product-title`, `[data-product-title]`, etc.
- Images: Hero images prioritized, filters out logos/icons

## Adding New Features

### New Tab Pattern

1. Add tab button in `page.jsx`
2. Add tab content with conditional rendering
3. Create API route at `app/api/new-feature/route.js`
4. Reuse shared utilities (cost calculation, model configs)

### New Model Pattern

Add to model options array in `page.jsx`, then handle in API route's model switch statement.

## Vercel Deployment

**Build Command**: `npm run build`
**Output Directory**: `.next`
**Install Command**: `npm install`

### Constraints

| Do | Don't |
|----|-------|
| Use in-memory processing | Write to file system |
| Stream long responses | Block for >10s (free tier) |
| Use environment variables | Hardcode API keys |
| Keep functions stateless | Rely on persistent state |

### Deployment Commands

```bash
vercel          # Deploy to preview
vercel --prod   # Deploy to production
```
