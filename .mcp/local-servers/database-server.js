import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

class LocalDatabaseServer {
  constructor() {
    this.server = new Server(
      { name: 'local-database', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.pool = null;

    this.setupHandlers();
  }

  async setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'list_tables',
            description: 'List all tables in the database',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'read_query',
            description: 'Execute a SELECT query',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query']
            }
          },
          {
            name: 'write_query',
            description: 'Execute INSERT, UPDATE, or DELETE query',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query']
            }
          },
          {
            name: 'describe_table',
            description: 'Describe table structure',
            inputSchema: {
              type: 'object',
              properties: {
                table: { type: 'string' }
              },
              required: ['table']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (!this.pool) {
          this.pool = new pg.Pool({
            connectionString: process.env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30000
          });
        }

        const client = await this.pool.connect();

        try {
          switch (name) {
            case 'list_tables':
              const tablesResult = await client.query(`
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
              `);
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(tablesResult.rows.map(r => r.tablename), null, 2)
                }]
              };

            case 'read_query':
              if (!args.query.toLowerCase().trim().startsWith('select')) {
                throw new Error('Only SELECT queries allowed in read_query');
              }
              const readResult = await client.query(args.query);
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(readResult.rows, null, 2)
                }]
              };

            case 'write_query':
              const writeQuery = args.query.toLowerCase().trim();
              if (!writeQuery.startsWith('insert') &&
                  !writeQuery.startsWith('update') &&
                  !writeQuery.startsWith('delete')) {
                throw new Error('Only INSERT, UPDATE, DELETE queries allowed in write_query');
              }
              const writeResult = await client.query(args.query);
              return {
                content: [{
                  type: 'text',
                  text: `Query executed. Affected rows: ${writeResult.rowCount || 0}`
                }]
              };

            case 'describe_table':
              const describeResult = await client.query(`
                SELECT
                  column_name,
                  data_type,
                  is_nullable,
                  column_default
                FROM information_schema.columns
                WHERE table_name = $1
                AND table_schema = 'public'
                ORDER BY ordinal_position
              `, [args.table]);

              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(describeResult.rows, null, 2)
                }]
              };

            default:
              throw new Error(`Unknown tool: ${name}`);
          }
        } finally {
          client.release();
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
      console.error('Local Database MCP server started successfully');

      // Graceful shutdown handling
      process.on('SIGINT', async () => {
        console.error('Shutting down Database server...');
        if (this.pool) {
          await this.pool.end();
        }
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.error('Shutting down Database server...');
        if (this.pool) {
          await this.pool.end();
        }
        process.exit(0);
      });

    } catch (error) {
      console.error('Failed to start Database MCP server:', error);
      process.exit(1);
    }
  }
}

const server = new LocalDatabaseServer();
server.start().catch(console.error);