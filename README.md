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
    npm install
    ```

2. **Set up the database**:

    ```bash
    npx zenstack generate
    npx prisma db push
    ```

3. **Seed the database** (optional):

    ```bash
    npx prisma db seed
    ```

    It create 3 users with posts. The passwords for all users are `password123`.

    - alex@zenstack.dev
    - sarah@stripe.com
    - jordan@vercel.com

4. **Start the server**:

    ```bash
    npm run dev
    ```

## Testing the MCP Server

### MCP Inspector

The easiest way to test the MCP server is to run

```bash
npx @modelcontextprotocol/inspector
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

Since `mcp-remote` only register oauth client for the first time, if you ever see the `invalid client` error when connecting, you can fix it by removing the cached client state:

```bash
rm -rf ~/.mcp-auth
```
