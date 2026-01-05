# Tab 3: Text-Based Email Generator

## Status: IMPLEMENTED

**Completed**: 2026-01-04
**Build**: Passing
**Dev Server**: http://localhost:5000

---

## Overview

**Feature Name**: Text-Based Email Generator
**Purpose**: Generate plain text emails using business research data and email guidelines
**AI Provider**: OpenAI only (GPT-5.2 series via Responses API)
**Output Format**: Plain text with Subject line (copy/paste ready)

---

## Implementation Summary

### Files Created
| File | Purpose |
|------|---------|
| `app/api/generate-text-email/route.js` | API endpoint for text email generation |

### Files Modified
| File | Changes |
|------|---------|
| `app/page.jsx` | Added Tab 3 state, handlers, UI components, Gmail preview |

### Tab Navigation
- Tab 1: "Email Generator" (unchanged)
- Tab 2: "Template-Based" (renamed from "New Feature")
- Tab 3: "Text Email Generator" (new)

---

## Features Implemented

### Models (OpenAI Responses API)
| Model ID | Label | Description |
|----------|-------|-------------|
| `gpt-5.2` | GPT-5.2 | Standard generation |
| `gpt-5.2-pro` | GPT-5.2 Pro | Deeper reasoning |

### Input Components

1. **Model Selector** - Dropdown to choose between GPT-5.2 and GPT-5.2 Pro

2. **Business Info RAG Data** (File Upload - REQUIRED)
   - Format: Markdown (.md) only
   - Purpose: Research collected on a business
   - Validation: File extension + non-empty content

3. **Email Templates & Guidelines** (File Upload - REQUIRED)
   - Format: Markdown (.md) only
   - Purpose: Email writing guidelines and strategies
   - Validation: File extension + non-empty content

4. **System Prompt** (Text Area)
   - Label: "System Prompt (applies to all emails)"
   - Starts empty
   - Optional field

5. **User Prompt** (Text Area - REQUIRED)
   - Label: "User Prompt (specific to this email)"
   - Starts empty
   - Required for generation

### Output Features

- **Gmail-style Preview**: Clean display of generated email
- **Full Email Text**: Includes Subject line, ready to copy/paste
- **Usage Stats**: Tokens, Cost, Generation Time
- **Copy Button**: One-click copy to clipboard
- **Download Button**: Save as .txt file
- **Raw Text View**: Expandable section showing raw output

---

## API Endpoint

### `POST /api/generate-text-email`

**Request**:
```json
{
  "businessInfo": "# Business Research\n...",
  "emailGuidelines": "# Email Templates\n...",
  "systemPrompt": "You are a sales representative...",
  "userPrompt": "Write an intro email to John about...",
  "model": "gpt-5.2"
}
```

**Response**:
```json
{
  "success": true,
  "content": "Subject: Quick question about...\n\nHi John,\n\n...",
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 400,
    "total_tokens": 1900,
    "estimated_cost_usd": 0.0025,
    "generation_time_ms": 1234
  }
}
```

**Validation**:
- Model must be `gpt-5.2` or `gpt-5.2-pro`
- Business Info required (non-empty markdown)
- Email Guidelines required (non-empty markdown)
- User Prompt required (non-empty string)
- OpenAI API key must be configured

---

## Cost Calculation (Placeholder)

```javascript
// Update with actual pricing when available
const pricing = {
  'gpt-5.2': { input: 0.002, output: 0.008 },      // per 1K tokens
  'gpt-5.2-pro': { input: 0.010, output: 0.040 }   // per 1K tokens
};
```

---

## Testing Checklist

- [x] Tab 3 visible in navigation
- [x] Model selector works (2 options)
- [x] Business Info file upload accepts .md only
- [x] Email Guidelines file upload accepts .md only
- [x] System Prompt textarea editable
- [x] User Prompt textarea editable
- [x] Generate button triggers API call
- [x] Loading state displays correctly
- [x] Error messages display correctly
- [x] Gmail preview renders generated email
- [x] Usage stats (tokens, cost, time) display
- [x] Copy button works
- [x] Download button saves .txt file
- [x] Raw text view expandable
- [x] Build passes with no errors

---

## Usage Instructions

1. Navigate to **Text Email Generator** tab
2. Select model (GPT-5.2 or GPT-5.2 Pro)
3. Upload **Business Info** markdown file (research on target business)
4. Upload **Email Guidelines** markdown file (writing rules and templates)
5. (Optional) Enter **System Prompt** for global instructions
6. Enter **User Prompt** describing the email to generate
7. Click **Generate Email**
8. Review email in Gmail-style preview
9. Copy or download the generated text

---

## Sample Test Files

### business-info.md
```markdown
# Company Research: TechCorp

## Overview
- Founded: 2018
- Industry: SaaS / Marketing Technology
- Size: 50-200 employees

## Key People
- Sarah Johnson, CEO - Former VP at Salesforce

## Pain Points
- Scaling customer acquisition
- Marketing attribution challenges
```

### email-guidelines.md
```markdown
# Email Writing Guidelines

## Tone & Style
- Professional but conversational
- Direct and value-focused

## Structure
1. Opening: Reference something specific about them
2. Value prop: One clear benefit statement
3. CTA: Single, clear next step

## Length
- Keep under 150 words
- Subject line: 5-8 words
```

---

## Known Limitations

1. **Model Availability**: GPT-5.2 models must be available in your OpenAI account
2. **Pricing**: Cost calculation uses placeholder values until official pricing is released
3. **No Streaming**: Response is returned all at once (not streamed)

---

## Future Enhancements (Out of Scope)

- Email thread simulation (reply chains)
- A/B testing between models
- Save/load prompt presets
- Email scoring/rating system
- Reasoning effort parameter (`reasoning.effort`)

---

*Last Updated: 2026-01-04*
*Status: IMPLEMENTED - Ready for Testing*
