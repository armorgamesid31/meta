import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';

class LocalPlaywrightServer {
  constructor() {
    this.server = new Server(
      { name: 'local-playwright', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.browser = null;
    this.page = null;
    this.consoleLogs = [];
    this.jsErrors = [];
    this.networkActivity = [];

    this.setupHandlers();
  }

  async setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'playwright_navigate',
            description: 'Navigate to a URL',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                headless: { type: 'boolean', default: false }
              },
              required: ['url']
            }
          },
          {
            name: 'playwright_click',
            description: 'Click an element',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string' }
              },
              required: ['selector']
            }
          },
          {
            name: 'playwright_fill',
            description: 'Fill an input field',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
                value: { type: 'string' }
              },
              required: ['selector', 'value']
            }
          },
          {
            name: 'playwright_screenshot',
            description: 'Take a screenshot',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                fullPage: { type: 'boolean', default: false }
              },
              required: ['name']
            }
          },
          {
            name: 'playwright_close',
            description: 'Close browser',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'playwright_get_visible_text',
            description: 'Get all visible text from the page',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'playwright_get_html',
            description: 'Get the HTML content of the page',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'playwright_list_clickables',
            description: 'List all clickable elements on the page',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'playwright_get_console_logs',
            description: 'Get all browser console logs captured since page creation',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'playwright_get_js_errors',
            description: 'Get all JavaScript runtime errors captured since page creation',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'playwright_get_network_activity',
            description: 'Get all network requests and responses captured since page creation',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'playwright_navigate':
            if (!this.browser) {
              this.browser = await chromium.launch({ headless: true });
              this.page = await this.browser.newPage();
              // Performance optimizations
              await this.page.setDefaultTimeout(5000);
              await this.page.setDefaultNavigationTimeout(5000);

              // Setup debug event listeners
              this.page.on('console', (msg) => {
                this.consoleLogs.push({
                  type: msg.type(),
                  text: msg.text(),
                  timestamp: new Date().toISOString()
                });
              });

              this.page.on('pageerror', (error) => {
                this.jsErrors.push({
                  message: error.message,
                  stack: error.stack,
                  timestamp: new Date().toISOString()
                });
              });

              this.page.on('request', (request) => {
                this.networkActivity.push({
                  type: 'request',
                  method: request.method(),
                  url: request.url(),
                  timestamp: new Date().toISOString()
                });
              });

              this.page.on('response', (response) => {
                this.networkActivity.push({
                  type: 'response',
                  status: response.status(),
                  url: response.url(),
                  timestamp: new Date().toISOString()
                });
              });
            }
            await this.page.goto(args.url);
            return { content: [{ type: 'text', text: `Navigated to ${args.url}` }] };

          case 'playwright_click':
            await this.page.click(args.selector);
            return { content: [{ type: 'text', text: `Clicked ${args.selector}` }] };

          case 'playwright_fill':
            await this.page.fill(args.selector, args.value);
            return { content: [{ type: 'text', text: `Filled ${args.selector} with ${args.value}` }] };

          case 'playwright_screenshot':
            const screenshotPath = `./${args.name}.png`;
            await this.page.screenshot({ path: screenshotPath, fullPage: args.fullPage || false });
            return { content: [{ type: 'text', text: `Screenshot saved to ${screenshotPath}` }] };

          case 'playwright_close':
            if (this.browser) {
              await this.browser.close();
              this.browser = null;
              this.page = null;
              // Clear debug logs when browser closes
              this.consoleLogs = [];
              this.jsErrors = [];
              this.networkActivity = [];
            }
            return { content: [{ type: 'text', text: 'Browser closed' }] };

          case 'playwright_get_visible_text':
            if (!this.page) {
              throw new Error('Browser not initialized. Use playwright_navigate first.');
            }
            const visibleText = await this.page.evaluate(() => document.body.innerText);
            return { content: [{ type: 'text', text: visibleText }] };

          case 'playwright_get_html':
            if (!this.page) {
              throw new Error('Browser not initialized. Use playwright_navigate first.');
            }
            const html = await this.page.evaluate(() => document.documentElement.outerHTML);
            return { content: [{ type: 'text', text: html }] };

          case 'playwright_list_clickables':
            if (!this.page) {
              throw new Error('Browser not initialized. Use playwright_navigate first.');
            }
            const clickables = await this.page.evaluate(() =>
              Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'))
                .map(el => ({
                  tag: el.tagName,
                  text: el.innerText?.trim().slice(0, 100) || '',
                  disabled: el.disabled || false
                }))
            );
            return { content: [{ type: 'text', text: JSON.stringify(clickables, null, 2) }] };

          case 'playwright_get_console_logs':
            return { content: [{ type: 'text', text: JSON.stringify(this.consoleLogs, null, 2) }] };

          case 'playwright_get_js_errors':
            return { content: [{ type: 'text', text: JSON.stringify(this.jsErrors, null, 2) }] };

          case 'playwright_get_network_activity':
            return { content: [{ type: 'text', text: JSON.stringify(this.networkActivity, null, 2) }] };

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    });
  }

  async start() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Local Playwright MCP server started successfully');

      // Graceful shutdown handling
      process.on('SIGINT', async () => {
        console.error('Shutting down Playwright server...');
        if (this.browser) {
          await this.browser.close();
        }
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.error('Shutting down Playwright server...');
        if (this.browser) {
          await this.browser.close();
        }
        process.exit(0);
      });

    } catch (error) {
      console.error('Failed to start Playwright MCP server:', error);
      process.exit(1);
    }
  }
}

const server = new LocalPlaywrightServer();
server.start().catch(console.error);