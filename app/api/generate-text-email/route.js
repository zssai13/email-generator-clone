import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';

// Allow up to 5 minutes for Vercel Pro
export const maxDuration = 300;

// Initialize Anthropic client lazily
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable.');
  }

  return new Anthropic({ apiKey });
}

// Initialize OpenAI client lazily
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.');
  }

  return new OpenAI({ apiKey });
}

// Initialize xAI client lazily (OpenAI-compatible)
function getXAIClient() {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error('xAI API key is not configured. Please set XAI_API_KEY environment variable.');
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1'
  });
}

// URL validation helper
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Model configuration
function getModelConfig(model) {
  const configs = {
    'gpt-5.2': {
      modelId: 'gpt-5.2',
      maxOutputTokens: 4000,
      provider: 'openai',
      apiType: 'responses'
    },
    'gpt-5.2-pro': {
      modelId: 'gpt-5.2-pro',
      maxOutputTokens: 4000,
      provider: 'openai',
      apiType: 'responses'
    },
    'grok-4-1-fast': {
      modelId: 'grok-4-1-fast',
      maxOutputTokens: 4000,
      provider: 'xai',
      apiType: 'chat'
    },
    'claude-opus-4-6': {
      modelId: 'claude-opus-4-6',
      maxOutputTokens: 4000,
      provider: 'anthropic',
      apiType: 'messages'
    }
  };
  return configs[model] || configs['gpt-5.2'];
}

// Build the input prompt from all components
function buildTextEmailInput(businessInfo, guidelines, systemPrompt, userPrompt, pageContext) {
  let input = '';

  // Add system prompt if provided
  if (systemPrompt && systemPrompt.trim()) {
    input += `## Instructions\n${systemPrompt.trim()}\n\n`;
  }

  // Add business context
  input += `## Business Context (RAG Data)\n${businessInfo.trim()}\n\n`;

  // Add page context (if URL was extracted)
  if (pageContext && pageContext.trim()) {
    input += `## Page Context (Extracted from URL)\n${pageContext.trim()}\n\n`;
  }

  // Add email guidelines (if provided)
  if (guidelines && guidelines.trim()) {
    input += `## Email Guidelines & Templates\n${guidelines.trim()}\n\n`;
  }

  // Add user task
  input += `## Your Task\n${userPrompt.trim()}\n\n`;

  // Add output instructions
  input += `Generate a complete plain text email including the Subject line at the top.
Format the output exactly like this:
Subject: [Your subject line here]

[Email body here]

The email should be ready to copy and paste directly into an email client.`;

  return input;
}

// Build messages for Chat Completions API (used by xAI/Grok)
function buildChatMessages(businessInfo, guidelines, systemPrompt, userPrompt, pageContext) {
  const systemContent = `You are an expert email copywriter. Your task is to generate high-quality, personalized emails.

${systemPrompt ? `## Additional Instructions\n${systemPrompt.trim()}\n\n` : ''}## Business Context (RAG Data)
${businessInfo.trim()}
${pageContext?.trim() ? `\n## Page Context (Extracted from URL)\n${pageContext.trim()}` : ''}
${guidelines?.trim() ? `\n## Email Guidelines & Templates\n${guidelines.trim()}` : ''}

Generate a complete plain text email including the Subject line at the top.
Format the output exactly like this:
Subject: [Your subject line here]

[Email body here]

The email should be ready to copy and paste directly into an email client.`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userPrompt.trim() }
  ];
}

// Calculate cost based on model and usage
function calculateCost(modelId, usage) {
  // Pricing per 1K tokens (placeholder values - update with actual pricing)
  const pricing = {
    'gpt-5.2': { input: 0.002, output: 0.008 },
    'gpt-5.2-pro': { input: 0.010, output: 0.040 },
    'grok-4-1-fast': { input: 0.003, output: 0.015 },  // Placeholder xAI pricing
    'claude-opus-4-6': { input: 0.005, output: 0.025 }  // $5/$25 per 1M tokens
  };

  const modelPricing = pricing[modelId] || pricing['gpt-5.2'];
  const inputTokens = usage?.input_tokens || usage?.prompt_tokens || 0;
  const outputTokens = usage?.output_tokens || usage?.completion_tokens || 0;

  const inputCost = (inputTokens / 1000) * modelPricing.input;
  const outputCost = (outputTokens / 1000) * modelPricing.output;

  return inputCost + outputCost;
}

// Extract full visible text from a web page using Cheerio (free)
async function extractPageText(pageUrl) {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract structured metadata
    const metadata = {};
    metadata.title = $('meta[property="og:title"]').attr('content')
      || $('title').text().trim()
      || $('h1').first().text().trim()
      || '';
    metadata.description = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || '';
    metadata.siteName = $('meta[property="og:site_name"]').attr('content') || '';
    metadata.type = $('meta[property="og:type"]').attr('content') || '';

    // Extract JSON-LD structured data (all types, not just Product)
    const jsonLdEntries = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const parsed = JSON.parse($(el).html());
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const entry = { type: item['@type'] || 'unknown' };
          if (item.name) entry.name = item.name;
          if (item.description) entry.description = item.description;
          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
            entry.price = offers[0]?.price;
            entry.priceCurrency = offers[0]?.priceCurrency;
          }
          if (item.author) entry.author = typeof item.author === 'string' ? item.author : item.author?.name;
          if (item.datePublished) entry.datePublished = item.datePublished;
          jsonLdEntries.push(entry);

          if (item['@graph']) {
            for (const graphItem of item['@graph']) {
              const gEntry = { type: graphItem['@type'] || 'unknown' };
              if (graphItem.name) gEntry.name = graphItem.name;
              if (graphItem.description) gEntry.description = graphItem.description;
              jsonLdEntries.push(gEntry);
            }
          }
        }
      } catch (e) { /* ignore malformed JSON-LD */ }
    });

    // Remove non-content elements to get clean visible text
    $('script, style, noscript, svg, iframe').remove();

    // Prefer main content areas over full body
    let bodyText = '';
    const mainContentSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '#content', '#main'];
    for (const selector of mainContentSelectors) {
      const el = $(selector);
      if (el.length && el.text().trim().length > 200) {
        bodyText = el.text();
        break;
      }
    }
    if (!bodyText) {
      bodyText = $('body').text();
    }

    // Clean up whitespace
    bodyText = bodyText
      .replace(/[\t ]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .replace(/\n /g, '\n')
      .trim();

    // Truncate if extremely long
    const MAX_TEXT_LENGTH = 8000;
    if (bodyText.length > MAX_TEXT_LENGTH) {
      bodyText = bodyText.substring(0, MAX_TEXT_LENGTH) + `\n\n[Text truncated - original length: ${bodyText.length} characters]`;
    }

    console.log('Page Text Extraction Complete:', {
      url: pageUrl,
      title: metadata.title?.substring(0, 60),
      bodyTextLength: bodyText.length,
      jsonLdEntries: jsonLdEntries.length,
      hasDescription: !!metadata.description
    });

    return {
      url: pageUrl,
      metadata,
      jsonLd: jsonLdEntries.length > 0 ? jsonLdEntries : null,
      bodyText
    };

  } catch (error) {
    console.error('Page text extraction error:', error);
    throw new Error(`Page extraction failed: ${error.message}`);
  }
}

// Refine raw page extraction into clean markdown summary using GPT-4o Mini
async function refinePageTextWithMini(rawExtraction) {
  const openaiClient = getOpenAIClient();

  const refinementPrompt = `You are a text extraction assistant. Below is raw content extracted from a web page. Your job is to organize this into a clean, readable summary that would be useful context for writing a personalized email.

URL: ${rawExtraction.url}
Page Title: ${rawExtraction.metadata.title || 'Unknown'}
Page Description: ${rawExtraction.metadata.description || 'None'}
Site: ${rawExtraction.metadata.siteName || 'Unknown'}
${rawExtraction.jsonLd ? `\nStructured Data:\n${JSON.stringify(rawExtraction.jsonLd, null, 2)}` : ''}

--- RAW PAGE TEXT ---
${rawExtraction.bodyText}
--- END RAW TEXT ---

Please produce a clean, well-organized summary of this page's content. Include:
1. What the page/company/product is about
2. Key offerings, features, or value propositions mentioned
3. Any pricing, plans, or specific details
4. Notable claims, testimonials, or social proof
5. Contact info or CTAs if present

Keep the summary concise but comprehensive (aim for 500-1500 words). Use markdown formatting with headers and bullet points. Do NOT fabricate information not present on the page.`;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: refinementPrompt }],
    max_tokens: 2000
  });

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  // GPT-4o Mini pricing: $0.15/1M input, $0.60/1M output
  const MINI_INPUT = 0.00015 / 1000;
  const MINI_OUTPUT = 0.0006 / 1000;
  const cost = (inputTokens * MINI_INPUT) + (outputTokens * MINI_OUTPUT);

  const refinedText = response.choices[0]?.message?.content || rawExtraction.bodyText;

  console.log('Page Text Refinement Complete:', {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost: `$${cost.toFixed(6)}`,
    refined_length: refinedText.length
  });

  return {
    refinedText,
    extractionUsage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: cost
    }
  };
}

// Pre-summarize RAG data with GPT-4o Mini to reduce input tokens for expensive models
async function presummarizeWithMini(businessInfo, userPrompt) {
  const openaiClient = getOpenAIClient();

  const presummaryPrompt = `You are a context extraction assistant. Your task is to read a business knowledge base and a user's email request, then extract ONLY the sections relevant to writing that specific email.

## User's Email Request:
${userPrompt}

## Full Business Knowledge Base:
${businessInfo}

## Instructions:
1. Read the user's email request carefully to understand what email they want to write
2. Extract ONLY the sections from the knowledge base that are directly relevant to this specific email
3. PRESERVE exact details: product names, prices, ingredients, policies, testimonials — do NOT paraphrase or summarize numbers/claims
4. ALWAYS include the tone/style guidance section (it applies to every email)
5. DROP: irrelevant products, source URLs/citations, duplicate sections that repeat the same info, general background not needed for this specific email
6. Output clean markdown with the relevant extracted sections
7. Aim for 500-1000 words of highly relevant context`;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: presummaryPrompt }],
    max_tokens: 2000
  });

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  // GPT-4o Mini pricing: $0.15/1M input, $0.60/1M output
  const MINI_INPUT = 0.00015 / 1000;
  const MINI_OUTPUT = 0.0006 / 1000;
  const cost = (inputTokens * MINI_INPUT) + (outputTokens * MINI_OUTPUT);

  const condensedContext = response.choices[0]?.message?.content || businessInfo;

  console.log('RAG Pre-Summary Complete:', {
    original_length: businessInfo.length,
    condensed_length: condensedContext.length,
    reduction: `${Math.round((1 - condensedContext.length / businessInfo.length) * 100)}%`,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost: `$${cost.toFixed(6)}`
  });

  return {
    condensedContext,
    presummaryUsage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: cost
    }
  };
}

// Generate text email using OpenAI Responses API (GPT-5.2)
async function generateWithResponsesAPI(client, config, input) {
  const startTime = Date.now();

  const response = await client.responses.create({
    model: config.modelId,
    input: input,
    max_output_tokens: config.maxOutputTokens
  });

  const generationTimeMs = Date.now() - startTime;

  const usage = {
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
    total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    estimated_cost_usd: calculateCost(config.modelId, response.usage),
    generation_time_ms: generationTimeMs
  };

  console.log('Text Email Generation Complete (Responses API):', {
    model: config.modelId,
    tokens: usage.total_tokens,
    cost: `$${usage.estimated_cost_usd.toFixed(6)}`,
    time: `${generationTimeMs}ms`
  });

  return {
    content: response.output_text,
    usage
  };
}

// Generate text email using Chat Completions API (xAI/Grok)
async function generateWithChatAPI(client, config, messages) {
  const startTime = Date.now();

  const response = await client.chat.completions.create({
    model: config.modelId,
    messages: messages,
    max_tokens: config.maxOutputTokens
  });

  const generationTimeMs = Date.now() - startTime;

  const usage = {
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0,
    total_tokens: response.usage?.total_tokens || 0,
    estimated_cost_usd: calculateCost(config.modelId, {
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens
    }),
    generation_time_ms: generationTimeMs
  };

  console.log('Text Email Generation Complete (Chat API):', {
    model: config.modelId,
    tokens: usage.total_tokens,
    cost: `$${usage.estimated_cost_usd.toFixed(6)}`,
    time: `${generationTimeMs}ms`
  });

  return {
    content: response.choices[0]?.message?.content || '',
    usage
  };
}

// Generate text email using Anthropic Messages API (Claude Opus 4.6)
async function generateWithAnthropicAPI(config, businessInfo, guidelines, systemPrompt, userPrompt, pageContext) {
  const anthropicClient = getAnthropicClient();
  const startTime = Date.now();

  // Build system prompt for Claude
  const systemContent = `You are an expert email copywriter. Your task is to generate high-quality, personalized emails.

${systemPrompt ? `## Additional Instructions\n${systemPrompt.trim()}\n\n` : ''}## Business Context (RAG Data)
${businessInfo.trim()}
${pageContext?.trim() ? `\n## Page Context (Extracted from URL)\n${pageContext.trim()}` : ''}
${guidelines?.trim() ? `\n## Email Guidelines & Templates\n${guidelines.trim()}` : ''}

Generate a complete plain text email including the Subject line at the top.
Format the output exactly like this:
Subject: [Your subject line here]

[Email body here]

The email should be ready to copy and paste directly into an email client.`;

  const response = await anthropicClient.messages.create({
    model: config.modelId,
    max_tokens: config.maxOutputTokens,
    system: systemContent,
    messages: [{ role: 'user', content: userPrompt.trim() }]
  });

  const generationTimeMs = Date.now() - startTime;

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;

  const usage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated_cost_usd: calculateCost(config.modelId, { input_tokens: inputTokens, output_tokens: outputTokens }),
    generation_time_ms: generationTimeMs
  };

  const content = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  console.log('Text Email Generation Complete (Anthropic API):', {
    model: config.modelId,
    tokens: usage.total_tokens,
    cost: `$${usage.estimated_cost_usd.toFixed(6)}`,
    time: `${generationTimeMs}ms`
  });

  return { content, usage };
}

// Validate markdown content
function isValidMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return content.trim().length > 0;
}

export async function POST(request) {
  try {
    const { businessInfo, emailGuidelines, systemPrompt, userPrompt, model, pageUrl, presummarize } = await request.json();

    // Validate model
    const validModels = ['gpt-5.2', 'gpt-5.2-pro', 'grok-4-1-fast', 'claude-opus-4-6'];
    const selectedModel = model || 'gpt-5.2';

    if (!validModels.includes(selectedModel)) {
      return Response.json({
        error: `Invalid model. Must be one of: ${validModels.join(', ')}`
      }, { status: 400 });
    }

    // Validate businessInfo (required)
    if (!businessInfo || typeof businessInfo !== 'string' || !businessInfo.trim()) {
      return Response.json({
        error: 'Business Info RAG data is required. Please upload a markdown file.'
      }, { status: 400 });
    }

    if (!isValidMarkdown(businessInfo)) {
      return Response.json({
        error: 'Business Info must be valid markdown content.'
      }, { status: 400 });
    }

    // Validate emailGuidelines (optional - if provided, must be valid)
    if (emailGuidelines !== undefined && emailGuidelines !== null && typeof emailGuidelines !== 'string') {
      return Response.json({
        error: 'Email Guidelines must be a string if provided.'
      }, { status: 400 });
    }

    // Validate systemPrompt (optional, can be empty)
    if (systemPrompt !== undefined && systemPrompt !== null && typeof systemPrompt !== 'string') {
      return Response.json({
        error: 'System prompt must be a string.'
      }, { status: 400 });
    }

    // Validate userPrompt (required for generation)
    if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
      return Response.json({
        error: 'User prompt is required. Please enter what email you want to generate.'
      }, { status: 400 });
    }

    // Validate pageUrl (optional)
    if (pageUrl && typeof pageUrl === 'string' && pageUrl.trim()) {
      if (!isValidUrl(pageUrl.trim())) {
        return Response.json({
          error: 'Invalid URL format. Please enter a valid http:// or https:// URL.'
        }, { status: 400 });
      }
    }

    // Get model config
    const modelConfig = getModelConfig(selectedModel);

    // Check API key based on provider
    if (modelConfig.provider === 'openai' && !process.env.OPENAI_API_KEY) {
      return Response.json({
        error: 'OpenAI API key is required but not configured. Please add OPENAI_API_KEY to your environment variables.'
      }, { status: 500 });
    }

    if (modelConfig.provider === 'xai' && !process.env.XAI_API_KEY) {
      return Response.json({
        error: 'xAI API key is required but not configured. Please add XAI_API_KEY to your environment variables.'
      }, { status: 500 });
    }

    if (modelConfig.provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
      return Response.json({
        error: 'Anthropic API key is required but not configured. Please add ANTHROPIC_API_KEY to your environment variables.'
      }, { status: 500 });
    }

    // Optional: Extract page context from URL
    let pageContext = '';
    let extractionUsage = null;

    if (pageUrl && typeof pageUrl === 'string' && pageUrl.trim()) {
      try {
        console.log('Extracting page text from:', pageUrl.trim());
        const rawExtraction = await extractPageText(pageUrl.trim());

        // Refine with GPT-4o Mini
        const { refinedText, extractionUsage: usage } = await refinePageTextWithMini(rawExtraction);
        pageContext = refinedText;
        extractionUsage = usage;

        console.log('Page context ready:', {
          url: pageUrl.trim(),
          contextLength: pageContext.length,
          extractionCost: `$${extractionUsage.estimated_cost_usd.toFixed(6)}`
        });
      } catch (extractionError) {
        console.error('Page extraction failed (continuing without it):', extractionError.message);
        // Non-fatal: continue generation without page context
      }
    }

    // Optional: Pre-summarize RAG data with GPT-4o Mini to reduce cost
    let effectiveBusinessInfo = businessInfo;
    let presummaryUsage = null;

    if (presummarize && businessInfo && businessInfo.trim()) {
      try {
        console.log('Pre-summarizing RAG data with GPT-4o Mini...');
        const { condensedContext, presummaryUsage: usage } = await presummarizeWithMini(businessInfo, userPrompt);
        effectiveBusinessInfo = condensedContext;
        presummaryUsage = usage;

        console.log('RAG pre-summary ready:', {
          originalLength: businessInfo.length,
          condensedLength: condensedContext.length,
          presummaryCost: `$${presummaryUsage.estimated_cost_usd.toFixed(6)}`
        });
      } catch (presummaryError) {
        console.error('Pre-summary failed (using full RAG):', presummaryError.message);
        // Non-fatal: continue with full businessInfo
      }
    }

    let result;

    // Route to appropriate API based on provider and API type
    if (modelConfig.provider === 'anthropic') {
      // Use Anthropic Messages API (Claude)
      result = await generateWithAnthropicAPI(modelConfig, effectiveBusinessInfo, emailGuidelines, systemPrompt || '', userPrompt, pageContext);
    } else if (modelConfig.provider === 'xai') {
      // Use xAI client with Chat Completions API
      const xaiClient = getXAIClient();
      const messages = buildChatMessages(effectiveBusinessInfo, emailGuidelines, systemPrompt || '', userPrompt, pageContext);
      result = await generateWithChatAPI(xaiClient, modelConfig, messages);
    } else if (modelConfig.apiType === 'responses') {
      // Use OpenAI Responses API (GPT-5.2)
      const openaiClient = getOpenAIClient();
      const input = buildTextEmailInput(effectiveBusinessInfo, emailGuidelines, systemPrompt || '', userPrompt, pageContext);
      result = await generateWithResponsesAPI(openaiClient, modelConfig, input);
    } else {
      // Fallback to Chat Completions API
      const openaiClient = getOpenAIClient();
      const messages = buildChatMessages(effectiveBusinessInfo, emailGuidelines, systemPrompt || '', userPrompt, pageContext);
      result = await generateWithChatAPI(openaiClient, modelConfig, messages);
    }

    // Validate output
    if (!result.content || result.content.trim().length < 10) {
      return Response.json({
        error: 'Failed to generate email. The response was empty or too short.'
      }, { status: 500 });
    }

    // Combine usage: presummary + extraction + generation
    const combinedUsage = { ...result.usage };
    if (presummaryUsage) {
      combinedUsage.presummary = presummaryUsage;
      combinedUsage.total_tokens += presummaryUsage.total_tokens;
      combinedUsage.estimated_cost_usd += presummaryUsage.estimated_cost_usd;
    }
    if (extractionUsage) {
      combinedUsage.extraction = extractionUsage;
      combinedUsage.total_tokens += extractionUsage.total_tokens;
      combinedUsage.estimated_cost_usd += extractionUsage.estimated_cost_usd;
    }

    return Response.json({
      success: true,
      content: result.content,
      usage: combinedUsage,
      pageExtracted: !!pageContext,
      presummarized: !!presummaryUsage
    });

  } catch (error) {
    console.error('Text Email API Error:', error);

    // Handle specific API errors
    if (error.message?.includes('API key')) {
      return Response.json({
        error: 'API key error. Please check your API key configuration.'
      }, { status: 500 });
    }

    if (error.message?.includes('model')) {
      return Response.json({
        error: `Model error: ${error.message}. The selected model may not be available.`
      }, { status: 500 });
    }

    return Response.json({
      error: error.message || 'Failed to generate email'
    }, { status: 500 });
  }
}
