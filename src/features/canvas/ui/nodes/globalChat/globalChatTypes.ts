

export interface McpServer {
  name?: string;
  displayName?: string;
  transport: { type: string };
}

export interface Skill {
  id: string;
  name: string;
  mcpServers?: string[];
}
