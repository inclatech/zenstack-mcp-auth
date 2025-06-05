import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import crudInputSchema from '@zenstackhq/runtime/zod/input';
import { getPrisma } from '.';

export function createMCPServer(userId: number) {
    const functionNames = ['findMany', 'createMany', 'deleteMany', 'updateMany'];
    const modelNames = ['Post', 'User'];
    // The LLM client does not seem to follow it when putting in the 'instructions' of MCP server.
    // So we have to repeat it in each tool description.
    const currentUserPrompt = `The current user id '${userId}'`;
    const server = new McpServer(
        {
            name: 'mcp-server-zenstack',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
                resources: {},
            },
            instructions: `This server provides access to the Prisma client API for model ${modelNames.join(
                ','
            )}. You can use the tools to interact with the database using the Prisma client API.
            ## Key Guidelines:
            1. ${currentUserPrompt}.
            2. When creating new records, strictly adhere to the required input schema, do not request or add fields that aren't part of the schema.
            `,
        }
    );

    const getModelName = (name: string) => name.replace('InputSchema', '');

    Object.entries(crudInputSchema)
        .filter(([name]) => modelNames.includes(getModelName(name)))
        .forEach(([name, functions]) => {
            const modelName = getModelName(name);

            Object.entries(functions as Record<string, any>)
                .filter(([functionName]) => functionNames.includes(functionName))
                .forEach(([functionName, schema]) => {
                    const toolName = `${modelName}_${functionName}`;
                    server.tool(
                        toolName,
                        `Prisma client API '${functionName}' function input argument for model '${modelName}'. ${currentUserPrompt}`,
                        {
                            args: schema,
                        },
                        async ({ args }) => {
                            console.log(`Calling tool: ${toolName} with args:`, JSON.stringify(args, null, 2));
                            const prisma = getPrisma(userId);
                            const data = await (prisma as any)[modelName][functionName](args);
                            console.log(`Tool ${toolName} returned:`, JSON.stringify(data, null, 2));
                            return {
                                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                            };
                        }
                    );
                });
        });

    return server;
}
