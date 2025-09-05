# ZenStack Remote MCP Server with Authorization

A Model Context Protocol (MCP) Streamable HTTP server supporting auto-generated CRUD tools of database with Authorization and credential Authentication.

## Features

-   **MCP Streamable HTTP Protocol**: Multiple simultaneous MCP server connections with credential Authentication support.
-   **ZenStack Integration**: Automatically generates MCP tools for the CRUD operations of the models defined in the ZenStack schema. This demo will use a simple blog application with `User` and `Post` models.

## Auto-generated Tools

The server automatically generates MCP tools for each model defined in the ZenStack schema. Here are the supported tools:

-   findUnique
-   findFirst
-   findMany
-   create
-   createMany
-   delete
-   deleteMany
-   update
-   updateMany
-   upsert
-   aggregate
-   groupBy
-   count

You can opt-in available tools for `functionNames` variable in `mcp-server.ts`

## Quick Start

1. **Install dependencies**:

    ```bash
    pnpm install
    ```

2. **Set up the database**:

    ```bash
    pnpx zenstack generate
    pnpx prisma db push
    ```

3. **Seed the database** (optional):

    ```bash
    pnpx prisma db seed
    ```

    It create 3 users with posts. The passwords for all users are `password123`.

    - alex@zenstack.dev
    - sarah@stripe.com
    - jordan@vercel.com

4. **Start the server**:

    ```bash
    pnpm run dev
    ```

## Testing the MCP Server

### MCP Inspector

The easiest way to test the MCP server is to run

```bash
pnpx @modelcontextprotocol/inspector
```

### MCP Client

If your chosen MCP client supports remote OAuth2 MCP server, you can directly connect. Otherwise, you can use `mcp-remote` to do it
All the most popular MCP clients (Claude Desktop, Cursor, Github Copilot) use the following config format:

```json
{
    "servers": {
        "my-mcp-server": {
            "command": "npx",
            "args": ["-y", "mcp-remote", "http://localhost:3001/mcp"]
        }
    }
}
```

## Troubleshooting

### Clear your ~/.mcp-auth directory

If you encounter an `invalid client` error when connecting to the MCP server, it may be due to that `mcp-remote` only register oauth client for the first time.you can fix it by removing the cached client state:

```bash
rm -rf ~/.mcp-auth
```

### Delete old versions of Node in NVM for Claude Desktop

When using Claude Desktop, if you didn't see any OAuth window open in your browser, it may be due to the fact that Claude Desktop is using an old version of Node.js even if you have a newer version installed. You can fix it by deleting old versions of Node.js in NVM.
