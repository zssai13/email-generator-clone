import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Define the tool Claude can use this is test pushss I am testing now
const tools = [
  {
    name: "fetch_url",
    description: "Fetches the HTML content of a URL",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch"
        }
      },
      required: ["url"]
    }
  }
];

// Execute the fetch tool when Claude calls it
async function executeTool(toolName, toolInput) {
  if (toolName === "fetch_url") {
    try {
      const response = await fetch(toolInput.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const html = await response.text();
      return html.substring(0, 100000);
    } catch (error) {
      return `Error fetching URL: ${error.message}`;
    }
  }
  return "Unknown tool";
}

// Extract clean HTML from Claude's response
function extractHtml(text) {
  // If wrapped in ```html ... ``` code blocks
  const codeBlockMatch = text.match(/```html\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // If wrapped in ``` ... ``` without language
  const genericCodeBlock = text.match(/```\s*(<!DOCTYPE[\s\S]*?<\/html>)\s*```/i);
  if (genericCodeBlock) {
    return genericCodeBlock[1].trim();
  }

  // Find HTML directly (from <!DOCTYPE to </html>)
  const htmlMatch = text.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
  if (htmlMatch) {
    return htmlMatch[1].trim();
  }

  return text.trim();
}

export async function POST(request) {
  try {
    const { productUrl, customPrompt } = await request.json();

    if (!productUrl) {
      return Response.json({ error: 'Product URL is required' }, { status: 400 });
    }

    // Build the prompt with optional custom instructions
    let promptContent = `Create a beautiful promotional ecommerce email for this product: ${productUrl}`;

    // Add custom prompt if provided
    if (customPrompt && customPrompt.trim()) {
      promptContent += `\n\nAdditional instructions: ${customPrompt.trim()}`;
    }

    promptContent += `\n\nReturn ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>. No markdown, no code blocks, no explanations.`;

    let messages = [
      {
        role: 'user',
        content: promptContent
      }
    ];

    let response = await client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 16000,
      tools,
      messages
    });

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');
      if (!toolUseBlock) break;

      const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);

      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { 
          role: 'user', 
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: toolResult
          }]
        }
      ];

      response = await client.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 16000,
        tools,
        messages
      });
    }

    // Extract and clean HTML
    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const emailHtml = extractHtml(rawResponse);

    return Response.json({ 
      success: true, 
      content: emailHtml
    });

  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate email' 
    }, { status: 500 });
  }
}
