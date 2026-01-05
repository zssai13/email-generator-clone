import OpenAI from 'openai';

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
    }
  };
  return configs[model] || configs['gpt-5.2'];
}

// Build the input prompt from all components
function buildTextEmailInput(businessInfo, guidelines, systemPrompt, userPrompt) {
  let input = '';

  // Add system prompt if provided
  if (systemPrompt && systemPrompt.trim()) {
    input += `## Instructions\n${systemPrompt.trim()}\n\n`;
  }

  // Add business context
  input += `## Business Context (RAG Data)\n${businessInfo.trim()}\n\n`;

  // Add email guidelines
  input += `## Email Guidelines & Templates\n${guidelines.trim()}\n\n`;

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
function buildChatMessages(businessInfo, guidelines, systemPrompt, userPrompt) {
  const systemContent = `You are an expert email copywriter. Your task is to generate high-quality, personalized emails.

${systemPrompt ? `## Additional Instructions\n${systemPrompt.trim()}\n\n` : ''}## Business Context (RAG Data)
${businessInfo.trim()}

## Email Guidelines & Templates
${guidelines.trim()}

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
    'grok-4-1-fast': { input: 0.003, output: 0.015 }  // Placeholder xAI pricing
  };

  const modelPricing = pricing[modelId] || pricing['gpt-5.2'];
  const inputTokens = usage?.input_tokens || usage?.prompt_tokens || 0;
  const outputTokens = usage?.output_tokens || usage?.completion_tokens || 0;

  const inputCost = (inputTokens / 1000) * modelPricing.input;
  const outputCost = (outputTokens / 1000) * modelPricing.output;

  return inputCost + outputCost;
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

// Validate markdown content
function isValidMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return content.trim().length > 0;
}

export async function POST(request) {
  try {
    const { businessInfo, emailGuidelines, systemPrompt, userPrompt, model } = await request.json();

    // Validate model
    const validModels = ['gpt-5.2', 'gpt-5.2-pro', 'grok-4-1-fast'];
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

    // Validate emailGuidelines (required)
    if (!emailGuidelines || typeof emailGuidelines !== 'string' || !emailGuidelines.trim()) {
      return Response.json({
        error: 'Email Guidelines are required. Please upload a markdown file.'
      }, { status: 400 });
    }

    if (!isValidMarkdown(emailGuidelines)) {
      return Response.json({
        error: 'Email Guidelines must be valid markdown content.'
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

    let result;

    // Route to appropriate API based on provider and API type
    if (modelConfig.provider === 'xai') {
      // Use xAI client with Chat Completions API
      const xaiClient = getXAIClient();
      const messages = buildChatMessages(businessInfo, emailGuidelines, systemPrompt || '', userPrompt);
      result = await generateWithChatAPI(xaiClient, modelConfig, messages);
    } else if (modelConfig.apiType === 'responses') {
      // Use OpenAI Responses API (GPT-5.2)
      const openaiClient = getOpenAIClient();
      const input = buildTextEmailInput(businessInfo, emailGuidelines, systemPrompt || '', userPrompt);
      result = await generateWithResponsesAPI(openaiClient, modelConfig, input);
    } else {
      // Fallback to Chat Completions API
      const openaiClient = getOpenAIClient();
      const messages = buildChatMessages(businessInfo, emailGuidelines, systemPrompt || '', userPrompt);
      result = await generateWithChatAPI(openaiClient, modelConfig, messages);
    }

    // Validate output
    if (!result.content || result.content.trim().length < 10) {
      return Response.json({
        error: 'Failed to generate email. The response was empty or too short.'
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      content: result.content,
      usage: result.usage
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
