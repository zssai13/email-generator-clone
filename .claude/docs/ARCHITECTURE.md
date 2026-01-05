# Email Generator - Architecture Documentation

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 14.2 (App Router) |
| **Frontend** | React 18.2, Tailwind CSS 3.4 |
| **Backend** | Next.js API Routes (serverless) |
| **AI - Anthropic** | Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 |
| **AI - OpenAI** | GPT-4o, GPT-4o Mini |
| **HTML Parsing** | Cheerio 1.0 (server-side) |
| **Deployment** | Vercel (serverless) |

## Directory Structure

```
email-generator-clone/
├── app/
│   ├── api/
│   │   ├── generate/
│   │   │   └── route.js        # Tab 1: Opus generation
│   │   └── generate-template/
│   │       └── route.js        # Tab 2: Template-based generation
│   ├── globals.css             # Tailwind imports
│   ├── layout.jsx              # Root layout
│   └── page.jsx                # Main UI (both tabs)
├── .claude/
│   ├── commands/
│   │   └── save-progress.md    # /save-progress slash command
│   └── docs/
│       ├── PRD.md              # Product requirements
│       └── ARCHITECTURE.md     # This file
├── .env.local                  # Local API keys (git-ignored)
├── CLAUDE.md                   # AI assistant quick reference
├── CHANGELOG.md                # Session changelog for continuity
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

## Shared Infrastructure

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...    # Required for Claude models
OPENAI_API_KEY=sk-...           # Required for GPT models
```

**Vercel Setup**: Add via Project Settings > Environment Variables

### Cost Calculation

Both API routes track and return token usage with cost estimates:

```javascript
// GPT-4o pricing
const GPT4O_INPUT = 0.0025 / 1000;   // per token
const GPT4O_OUTPUT = 0.010 / 1000;

// GPT-4o Mini pricing
const MINI_INPUT = 0.00015 / 1000;
const MINI_OUTPUT = 0.0006 / 1000;
```

### Product Data Extraction

Three strategies available:

1. **AI Extraction** (expensive): Claude/GPT fetches and analyzes page
2. **Hybrid** (balanced): Premium model extracts, Mini generates
3. **Manual + AI** (cheapest): Cheerio parses HTML, Mini refines

Manual extraction uses priority-based CSS selectors:
- Price: `.price`, `[data-price]`, `.product-price`, etc.
- Title: `h1`, `.product-title`, `[data-product-title]`, etc.
- Images: Hero images prioritized, filters out logos/icons

## Frontend Architecture

### Main Page (app/page.jsx)

Two-tab interface:
- **Tab 1**: Email Generator (Opus)
- **Tab 2**: Template-Based Generator

Key components:
- Model selector dropdown
- File upload for HTML templates
- Live preview iframe
- Cost/token display
- Copy to clipboard
- Download as HTML

### State Management

React useState for:
- Active tab
- Form inputs (URL, template, prompt, model)
- Generated emails list
- Loading states
- Error handling

## Adding New Features

### New Tab Pattern

1. **Add tab button** in `page.jsx`:
```jsx
<button onClick={() => setActiveTab('new-feature')}>
  New Feature
</button>
```

2. **Add tab content**:
```jsx
{activeTab === 'new-feature' && (
  <div>
    {/* New feature UI */}
  </div>
)}
```

3. **Create API route** at `app/api/new-feature/route.js`

4. **Reuse shared utilities** (cost calculation, model configs)

### New Model Pattern

Add to model options array in `page.jsx`:
```javascript
{ value: 'new-model', label: 'New Model Name' }
```

Handle in API route's model switch statement.

## Vercel Deployment

### Configuration

No special configuration needed - Next.js apps deploy automatically.

**Build Command**: `npm run build`
**Output Directory**: `.next`
**Install Command**: `npm install`

### Function Timeouts

Default: 10 seconds
Pro plan: Up to 60 seconds

**Long operations** (like Opus generation) may need:
- Streaming responses
- Or Vercel Pro plan for extended timeout

### Constraints to Remember

| Do | Don't |
|----|-------|
| Use in-memory processing | Write to file system |
| Stream long responses | Block for >10s (free tier) |
| Use environment variables | Hardcode API keys |
| Keep functions stateless | Rely on persistent state |

### Deployment Commands

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Environment Variables in Vercel

1. Go to Project Settings
2. Click "Environment Variables"
3. Add:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
4. Redeploy for changes to take effect

## Local Development

```bash
# Install dependencies
npm install

# Create .env.local with API keys
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
echo "OPENAI_API_KEY=sk-..." >> .env.local

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Server runs on `http://localhost:5000`
