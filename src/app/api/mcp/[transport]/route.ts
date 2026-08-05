import { createMcpHandler } from "mcp-handler";
import { requireAgentToken } from "@/lib/agent/auth";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => {
    registerAgentMcpTools(server);
  },
  {
    serverInfo: {
      name: "stock-hq",
      version: "0.4.3",
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    disableSse: true,
  },
);

async function handle(req: Request): Promise<Response> {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;
  return mcpHandler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
