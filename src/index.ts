import { PrismaClient } from '@prisma/client';
import { enhance } from '@zenstackhq/runtime';
import express, { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AuthMiddleware } from './auth/AuthMiddleware';
import { config } from './config';

const prisma = new PrismaClient();
const app = express();

// Initialize authentication middleware
const authMiddleware = new AuthMiddleware(prisma);

// Store active SSE connections
const activeConnections = new Map<string, SSEServerTransport>();

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
function getPrisma(userId: number | null) {
    const user = userId ? { id: userId } : undefined;
    return enhance(prisma, { user });
}

// Create MCP Server instance
function createMCPServer(userId: number | null): Server {
    const server = new Server(
        {
            name: 'zenstack-blog-server',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Define available tools
    const tools: Tool[] = [
        {
            name: 'get_posts',
            description: 'Get all posts visible to the current user',
            inputSchema: {
                type: 'object',
                properties: {
                    published: {
                        type: 'boolean',
                        description: 'Filter by published status',
                    },
                },
            },
        },
        {
            name: 'create_post',
            description: 'Create a new post',
            inputSchema: {
                type: 'object',
                properties: {
                    title: {
                        type: 'string',
                        description: 'Post title',
                    },
                    content: {
                        type: 'string',
                        description: 'Post content',
                    },
                    published: {
                        type: 'boolean',
                        description: 'Whether to publish the post',
                        default: false,
                    },
                },
                required: ['title'],
            },
        },
        {
            name: 'update_post',
            description: 'Update an existing post',
            inputSchema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'number',
                        description: 'Post ID',
                    },
                    title: {
                        type: 'string',
                        description: 'Post title',
                    },
                    content: {
                        type: 'string',
                        description: 'Post content',
                    },
                    published: {
                        type: 'boolean',
                        description: 'Whether to publish the post',
                    },
                },
                required: ['id'],
            },
        },
        {
            name: 'delete_post',
            description: 'Delete a post',
            inputSchema: {
                type: 'object',
                properties: {
                    id: {
                        type: 'number',
                        description: 'Post ID to delete',
                    },
                },
                required: ['id'],
            },
        },
        {
            name: 'get_users',
            description: 'Get all users',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
    ];

    // Handle list tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const db = getPrisma(userId);

        try {
            switch (name) {
                case 'get_posts': {
                    const posts = await db.post.findMany({
                        where: args?.published !== undefined ? { published: args.published as boolean } : undefined,
                        include: { author: true },
                        orderBy: { createdAt: 'desc' },
                    });

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(posts, null, 2),
                            },
                        ],
                    };
                }

                case 'create_post': {
                    if (!userId) {
                        throw new Error('Authentication required to create posts');
                    }

                    if (!args?.title) {
                        throw new Error('Title is required');
                    }

                    const post = await db.post.create({
                        data: {
                            title: args.title as string,
                            content: (args.content as string) || null,
                            published: (args.published as boolean) || false,
                            authorId: userId,
                        },
                        include: { author: true },
                    });

                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Post created successfully: ${JSON.stringify(post, null, 2)}`,
                            },
                        ],
                    };
                }

                case 'update_post': {
                    if (!args?.id) {
                        throw new Error('Post ID is required');
                    }

                    const updateData: any = {};
                    if (args.title !== undefined) updateData.title = args.title as string;
                    if (args.content !== undefined) updateData.content = args.content as string;
                    if (args.published !== undefined) updateData.published = args.published as boolean;

                    const post = await db.post.update({
                        where: { id: args.id as number },
                        data: updateData,
                        include: { author: true },
                    });

                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Post updated successfully: ${JSON.stringify(post, null, 2)}`,
                            },
                        ],
                    };
                }

                case 'delete_post': {
                    if (!args?.id) {
                        throw new Error('Post ID is required');
                    }

                    await db.post.delete({
                        where: { id: args.id as number },
                    });

                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Post with ID ${args.id} deleted successfully`,
                            },
                        ],
                    };
                }

                case 'get_users': {
                    const users = await db.user.findMany({
                        include: {
                            posts: {
                                where: { published: true },
                                select: { id: true, title: true, createdAt: true },
                            },
                        },
                    });

                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(users, null, 2),
                            },
                        ],
                    };
                }

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    });

    return server;
}

// SSE endpoint for MCP connections - handle both GET and POST
const handleSSEConnection = async (req: Request, res: Response) => {
    const userId = getUserId(req);

    // Require authentication for SSE connections
    if (!userId) {
        return authMiddleware.handle401(req, res);
    }

    // Create MCP server for this connection
    const transport = new SSEServerTransport('/message', res);
    console.log(`New SSE connection: ${transport.sessionId}, User ID: ${userId}`);

    // Store connection
    activeConnections.set(transport.sessionId, transport);
    const mcpServer = createMCPServer(userId);

    // Connect server to transport
    await mcpServer.connect(transport);

    // Handle connection close
    req.on('close', () => {
        console.log(`SSE connection closed: ${transport.sessionId}`);
        activeConnections.delete(transport.sessionId);
    });
};

app.post('/message', authMiddleware.getFlexibleAuthMiddleware(), async (req, res) => {
    console.log('Received message');
    const sessionId = req.query.sessionId as string;
    const transport = activeConnections.get(sessionId);
    if (transport) {
        // Use the already parsed body instead of getRawBody
        let messageBody = req.body;

        // If body is a string, parse it as JSON
        if (typeof messageBody === 'string') {
            try {
                messageBody = JSON.parse(messageBody);
            } catch (error) {
                console.error('Failed to parse message body:', error);
                res.status(400).json({ error: 'Invalid JSON in request body' });
                return;
            }
        }

        if (!messageBody.params) {
            messageBody.params = {};
        }

        await transport.handlePostMessage(req, res, messageBody);
    }
});

// Add flexible OAuth middleware to SSE endpoint (supports query params for EventSource)
app.get('/sse', authMiddleware.getFlexibleAuthMiddleware(), authMiddleware.getUserMiddleware(), handleSSEConnection);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeConnections: activeConnections.size,
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
🚀 MCP SSE Server ready at: ${config.baseUrl}
📡 SSE endpoint: ${config.baseUrl}/sse
🔐 OAuth endpoints:
   • Authorization: ${config.baseUrl}/oauth/authorize
   • Token: ${config.baseUrl}/oauth/token
   • Metadata: ${config.baseUrl}/.well-known/oauth-authorization-server
🏥 Health check: ${config.baseUrl}/health
📊 Active connections: ${activeConnections.size}

🔑 Demo credentials: Use any valid user ID and password "password123"
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');

    // Close all active connections
    activeConnections.forEach((res, connectionId) => {
        console.log(`Closing connection: ${connectionId}`);
        res.close();
    });

    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
