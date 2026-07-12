/**
 * MCP tool-bridge for API providers. CLIs load MCP via their own config, but a raw
 * OpenAI-compatible endpoint can't — so here the orchestrator acts as the MCP host:
 * connect to enabled MCP servers, expose their tools to the model via the OpenAI
 * `tools` param, execute any tool calls, and feed results back until the model
 * answers. Degrades gracefully: if MCP can't connect, chat proceeds tool-less.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { enabledForBridge } from './mcp.js';

/** Connect to all enabled MCP servers and collect their tools. */
export async function connectTools(onLog = () => {}) {
  const clients = [];
  const tools = []; // OpenAI tool schema
  const toolMap = new Map(); // toolName -> { client, mcpName }

  for (const s of enabledForBridge()) {
    try {
      const client = new Client({ name: 'jarvis', version: '1.0.0' }, { capabilities: {} });
      const transport =
        s.transport === 'http'
          ? new StreamableHTTPClientTransport(new URL(s.url))
          : new StdioClientTransport({ command: s.command, args: s.args, env: { ...process.env, ...s.env } });
      await client.connect(transport);
      clients.push(client);
      const list = await client.listTools();
      for (const t of list.tools || []) {
        const fqn = `${s.name}__${t.name}`.slice(0, 64);
        tools.push({
          type: 'function',
          function: {
            name: fqn,
            description: t.description || `${s.name} tool ${t.name}`,
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        });
        toolMap.set(fqn, { client, tool: t.name });
      }
      onLog(`[mcp] ${s.name}: ${list.tools?.length || 0} tools\n`);
    } catch (e) {
      onLog(`[mcp] ${s.name} failed: ${e.message}\n`);
    }
  }
  return { clients, tools, toolMap };
}

export async function callTool(toolMap, fqn, argsJson) {
  const entry = toolMap.get(fqn);
  if (!entry) return { error: `unknown tool ${fqn}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    /* leave empty */
  }
  const res = await entry.client.callTool({ name: entry.tool, arguments: args });
  // Flatten MCP content blocks to text.
  const text = (res.content || [])
    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
  return { text: text || JSON.stringify(res) };
}

export async function closeClients(clients) {
  for (const c of clients) {
    try {
      await c.close();
    } catch {
      /* ignore */
    }
  }
}
