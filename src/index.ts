import { PrismaClient } from '@prisma/client';
import { enhance } from '@zenstackhq/runtime';
import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { AuthMiddleware } from './auth/AuthMiddleware';
import { config } from './config';
import { createMCPServer } from './mcp-server';
import crypto from 'crypto';

const prisma = new PrismaClient();
const app = express();

// Initialize authentication middleware
const authMiddleware = new AuthMiddleware(prisma);

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For form submissions

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-USER-ID, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});

// Add OAuth routes
app.use('/', authMiddleware.getRouter());

function getUserId(req: Request): number | null {
    // First try OAuth authentication
    if (req.userId) {
        return req.userId;
    }

    // Fall back to header/query for backwards compatibility
    const userIdHeader = req.header('X-USER-ID');
    const userIdQuery = req.query['X-USER-ID'] as string;
    const userId = userIdHeader || userIdQuery;
    return userId ? parseInt(userId) : null;
}

// Gets a Prisma client bound to the current user identity
export function getPrisma(userId: number | null) {
    const user = userId ? { id: userId } : undefined;
    return enhance(prisma, { user });
}

// HTTP endpoint for MCP connections using Streamable HTTP transport
const handleMCPConnection = async (req: Request, res: Response) => {
    const userId = getUserId(req);

    // Require authentication for MCP connections
    if (!userId) {
        return authMiddleware.handle401(req, res);
    }

    // Check if this is a new connection or existing session
    const sessionId = req.header('mcp-session-Id') || (req.query.sessionId as string) || undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
        // Handle new MCP connection initialization
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sessionId: string) => {
                console.log(`New MCP session initialized: ${sessionId}, User ID: ${userId}`);
                transports[sessionId] = transport!;
            },
        });

        const mcpServer = createMCPServer(userId);
        await mcpServer.connect(transport);
        // Handle connection close
        transport.onclose = () => {
            if (transport?.sessionId) {
                console.log(`MCP session closed: ${transport.sessionId}`);
                delete transports[transport.sessionId];
            }
        };
    } else {
        // invalid request
        res.status(400).json({
            error: {
                code: -32000,
                message: 'Invalid MCP session request. Please provide a valid session ID or initialize a new session.',
            },
        });
        return;
    }
    // Handle the request
    await transport.handleRequest(req, res, req.body);
};

// Primary endpoint for MCP communication using Streamable HTTP transport
app.all('/mcp', authMiddleware.getFlexibleAuthMiddleware(), authMiddleware.getUserMiddleware(), handleMCPConnection);

// Legacy SSE endpoint for backwards compatibility
app.get('/sse', authMiddleware.getFlexibleAuthMiddleware(), authMiddleware.getUserMiddleware(), handleMCPConnection);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeConnections: transports.size,
        timestamp: new Date().toISOString(),
    });
});

// Legacy REST endpoint for backwards compatibility - protected
app.get('/post', authMiddleware.getAuthMiddleware(), authMiddleware.getUserMiddleware(), async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return authMiddleware.handle401(req, res);
        }

        const db = getPrisma(userId);
        const posts = await db.post.findMany({
            include: { author: true },
        });
        res.json(posts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

const server = app.listen(config.port, () => {
    console.log(`
🚀 MCP Streamable HTTP Server ready at: ${config.baseUrl}
📡 MCP endpoint: ${config.baseUrl}/mcp
📡 Legacy SSE endpoint: ${config.baseUrl}/sse
🔐 OAuth endpoints:
   • Authorization: ${config.baseUrl}/oauth/authorize
   • Token: ${config.baseUrl}/oauth/token
   • Metadata: ${config.baseUrl}/.well-known/oauth-authorization-server
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');

    // Close all active connections
    Object.entries(transports).forEach(([sessionId, transport]) => {
        console.log(`Closing connection: ${sessionId}`);
        transport.close();
    });

    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
