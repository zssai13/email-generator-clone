# Email Generator - Product Requirements Document

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

## Current Features

### Tab 1: Email Generator (Opus)

**Purpose**: Generate high-quality "gold standard" email templates

- Input: Product URL + email count (1-4) + optional promotion text
- Model: Claude Opus 4.5 (fixed - highest quality)
- Output: Multiple email variations in different styles
- Use case: Create reference templates for Tab 2

### Tab 2: Template-Based Generator

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
| **Text-only emails** | Plain text email generation (no HTML) |
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

## Deployment Constraints (Vercel)

| Constraint | Requirement |
|------------|-------------|
| **File system** | No writes - use in-memory or external storage |
| **Function timeout** | 10s default, 60s max (Pro plan) |
| **Environment variables** | Configure via Vercel dashboard |
| **Long-running processes** | Not supported - use streaming where needed |
| **Edge compatibility** | Prefer edge-compatible code where possible |

## Success Criteria

1. Team can quickly test new generation ideas
2. Cost and quality metrics are visible per generation
3. Templates created in Tab 1 work seamlessly in Tab 2
4. New features can be added without breaking existing functionality
5. Deploys successfully to Vercel without modification
