import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import crypto from 'crypto';
import { config } from './config';

// OAuth helper functions
function generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function performOAuthFlow(): Promise<string> {
    console.log('🔐 Starting OAuth flow...');

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Step 1: Get authorization code by simulating login
    const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: 'test_client',
        redirect_uri: `${config.baseUrl}/callback`,
        scope: 'read write',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    console.log('📋 Authorization URL:', `${config.baseUrl}/authorize?${authParams}`);

    // For testing, we'll simulate the login by directly posting credentials
    const loginResponse = await fetch(`${config.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: 'alice@prisma.io', // Use email instead of user ID
            password: 'password123',
            client_id: 'test_client',
            state: state,
            code_challenge: codeChallenge,
            redirect_uri: `${config.baseUrl}/callback`,
            scopes: 'read write',
        }),
        redirect: 'manual', // Don't follow redirects
    });

    if (!loginResponse.ok) {
        const errorData = await loginResponse.json();
        throw new Error(`Login failed: ${errorData.error || 'Unknown error'}`);
    }

    const loginResult = await loginResponse.json();

    if (!loginResult.success || !loginResult.redirectUrl) {
        throw new Error(`Login failed: ${loginResult.error || 'No redirect URL received'}`);
    }

    // Extract authorization code from redirect URL
    const redirectUrl = new URL(loginResult.redirectUrl);
    const code = redirectUrl.searchParams.get('code');
    const returnedState = redirectUrl.searchParams.get('state');

    if (!code) {
        throw new Error('No authorization code received');
    }

    if (returnedState !== state) {
        throw new Error('State mismatch in OAuth flow');
    }

    console.log('✅ Authorization code received');

    // Step 2: Exchange authorization code for access token
    const tokenResponse = await fetch(`${config.baseUrl}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: 'test_client',
            client_secret: 'test_secret',
            code: code,
            redirect_uri: `${config.baseUrl}/callback`,
            code_verifier: codeVerifier,
        }),
    });

    if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${error}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('✅ Access token received');

    return tokenData.access_token;
}

async function testMCPClient() {
    try {
        // Get OAuth access token
        const accessToken = await performOAuthFlow();

        console.log('Creating SSE transport with Bearer token...');
        // Since EventSource doesn't support Authorization headers,
        // we'll pass the token as a query parameter
        const sseUrl = new URL(`${config.baseUrl}/sse`);
        sseUrl.searchParams.set('access_token', accessToken);

        const transport = new SSEClientTransport(sseUrl, {
            requestInit: {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            },
        });

        console.log('Creating MCP client...');
        const client = new Client(
            {
                name: 'test-client',
                version: '1.0.0',
            },
            {
                capabilities: {},
            }
        );

        console.log('Connecting to MCP server...');
        await client.connect(transport);
        console.log('✅ Connected to MCP server!');

        console.log('Listing available tools...');
        const tools = await client.listTools();
        console.log(
            '✅ Available tools:',
            tools.tools.map((t) => t.name)
        );

        console.log('Testing Post_findMany tool...');
        const postsResult = await client.callTool({
            name: 'Post_findMany',
            arguments: { args: {} },
        });
        console.log('✅ Posts result:', (postsResult.content as any)[0]?.text?.substring(0, 200) + '...');

        console.log('Closing client...');
        await client.close();
        console.log('✅ Client closed');
    } catch (error) {
        console.error('❌ Error:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
        }
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    testMCPClient().catch(console.error);
}

export { testMCPClient };
