import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { makeServer } from './make-server.js';

const server = makeServer();
const transport = new StdioServerTransport();
await server.connect(transport);
