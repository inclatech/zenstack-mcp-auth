import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { PasswordAuthProvider } from './PasswordAuthProvider';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';

export class AuthMiddleware {
    private authProvider: PasswordAuthProvider;
    private authRouter: express.Router = express.Router();

    constructor(prisma: PrismaClient) {
        this.authProvider = new PasswordAuthProvider(prisma);
        this.setupRouter();
    }

    private setupRouter() {
        // Add OAuth router using the mcpAuthRouter function
        this.authRouter.use(
            '/',
            mcpAuthRouter({
                provider: this.authProvider,
                issuerUrl: new URL(config.baseUrl),
                baseUrl: new URL(config.baseUrl),
                scopesSupported: ['read', 'write'],
            })
        );

        // Add custom login handler with proper typing
        this.authRouter.post('/auth/login', async (req: Request, res: Response) => {
            await this.handleLogin(req, res);
        });

        // Serve static login page with URL parameters
        this.authRouter.get('/auth/login', (req: Request, res: Response) => {
            try {
                const templatePath = path.join(__dirname, 'login.html');
                const template = fs.readFileSync(templatePath, 'utf-8');
                res.setHeader('Content-Type', 'text/html');
                res.send(template);
            } catch (error) {
                console.error('Error serving login page:', error);
                res.status(500).send(`
<!DOCTYPE html>
<html>
<head><title>Login Error</title></head>
<body>
    <h1>Login Unavailable</h1>
    <p>The login form could not be loaded. Please contact the administrator.</p>
</body>
</html>`);
            }
        });

        // Add OAuth metadata endpoints
        this.authRouter.get('/.well-known/oauth-authorization-server', (req, res) => {
            res.json({
                issuer: config.baseUrl,
                authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
                token_endpoint: `${config.baseUrl}/oauth/token`,
                registration_endpoint: `${config.baseUrl}/oauth/register`,
                revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
                scopes_supported: ['read', 'write'],
                response_types_supported: ['code'],
                grant_types_supported: ['authorization_code', 'refresh_token'],
                token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
                code_challenge_methods_supported: ['S256'],
            });
        });

        // Add protected resource metadata
        this.authRouter.get('/.well-known/oauth-protected-resource', (req, res) => {
            res.json({
                resource: config.baseUrl,
                authorization_servers: [config.baseUrl],
                scopes_supported: ['read', 'write'],
                bearer_methods_supported: ['header'],
            });
        });
    }

    private async handleLogin(req: Request, res: Response) {
        try {
            const { user_id, password, client_id, state, code_challenge, redirect_uri, scopes } = req.body;

            if (!user_id || !password || !client_id || !code_challenge || !redirect_uri) {
                return res.status(400).send('Missing required parameters');
            }

            const userId = parseInt(user_id);
            const scopesArray = scopes ? scopes.split(' ').filter(Boolean) : [];

            const result = await this.authProvider.handleLogin(
                userId,
                password,
                client_id,
                state || '',
                code_challenge,
                redirect_uri,
                scopesArray
            );

            if (result.success && result.authCode) {
                // Redirect with authorization code
                const redirectUrl = new URL(redirect_uri);
                redirectUrl.searchParams.set('code', result.authCode);
                if (state) {
                    redirectUrl.searchParams.set('state', state);
                }
                res.redirect(redirectUrl.toString());
            } else {
                // Show error
                res.status(400).send(`
<!DOCTYPE html>
<html>
<head>
    <title>Login Error</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        .error { color: red; margin-bottom: 15px; }
        a { color: #007cba; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h2>Login Error</h2>
    <div class="error">${result.error || 'Login failed'}</div>
    <a href="javascript:history.back()">← Go back and try again</a>
</body>
</html>`);
            }
        } catch (error) {
            console.error('Login handler error:', error);
            res.status(500).send('Internal server error');
        }
    }

    /**
     * Middleware to verify Bearer tokens
     */
    public getAuthMiddleware() {
        return requireBearerAuth({ verifier: this.authProvider });
    }

    /**
     * Middleware to extract user ID from auth info
     */
    public getUserMiddleware() {
        return (req: Request & { auth?: AuthInfo }, res: Response, next: NextFunction) => {
            if (req.auth?.extra?.userId) {
                req.userId = req.auth.extra.userId as number;
            }
            next();
        };
    }

    /**
     * Get the auth router
     */
    public getRouter() {
        return this.authRouter;
    }

    /**
     * Get the auth provider
     */
    public getProvider() {
        return this.authProvider;
    }

    /**
     * Handle 401 responses with proper WWW-Authenticate header
     */
    public handle401(req: Request, res: Response) {
        res.setHeader(
            'WWW-Authenticate',
            `Bearer realm="MCP Server", auth_uri="${config.baseUrl}/.well-known/oauth-protected-resource"`
        );
        res.status(401).json({
            error: 'unauthorized',
            error_description: 'Valid access token required',
            auth_uri: `${config.baseUrl}/.well-known/oauth-protected-resource`,
        });
    }

    /**
     * Flexible middleware that supports both Authorization headers and query parameters
     * This is needed for SSE endpoints since EventSource doesn't support custom headers
     */
    public getFlexibleAuthMiddleware() {
        return async (req: Request & { auth?: AuthInfo }, res: Response, next: NextFunction) => {
            try {
                let token: string | undefined;

                // First, try to get token from Authorization header
                const authHeader = req.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }

                // If no header token, try query parameter (for SSE compatibility)
                if (!token && req.query.access_token) {
                    token = req.query.access_token as string;
                }

                if (!token) {
                    res.status(401).json({ error: 'Missing access token' });
                    return;
                }

                // Verify the token using our auth provider
                const authInfo = await this.authProvider.verifyAccessToken(token);
                if (!authInfo) {
                    res.status(401).json({ error: 'Invalid access token' });
                    return;
                }

                // Add auth info to request
                req.auth = authInfo;
                next();
            } catch (error) {
                console.error('Auth middleware error:', error);
                res.status(401).json({ error: 'Authentication failed' });
            }
        };
    }
}

// Extend Request interface to include auth info
declare global {
    namespace Express {
        interface Request {
            auth?: AuthInfo;
            userId?: number;
        }
    }
}
