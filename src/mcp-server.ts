import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import crudInputSchema from '@zenstackhq/runtime/zod/input';
import { getPrisma } from '.';

export function createMCPServer(userId: number) {
    const functionNames = ['findMany', 'createMany', 'deleteMany', 'updateMany'];
    const modelNames = ['Post', 'User'];
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
        }
    );

    const getModelName = (name: string) => name.replace('InputSchema', '');

    Object.entries(crudInputSchema)
        .filter(([name]) => modelNames.includes(getModelName(name)))
        .forEach(([name, functions]) => {
            const modelName = getModelName(name);

            Object.entries(functions)
                .filter(([functionName]) => functionNames.includes(functionName))
                .forEach(([functionName, schema]) => {
                    const toolName = `${modelName}_${functionName}`;
                    server.tool(
                        toolName,
                        `Prisma client API '${functionName}' function input argument for model '${modelName}'`,
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
