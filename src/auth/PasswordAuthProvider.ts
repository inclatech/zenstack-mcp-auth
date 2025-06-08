import { Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
    OAuthClientInformationFull,
    OAuthTokenRevocationRequest,
    OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { config } from '../config';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { DatabaseClientsStore } from './DatabaseClientsStore';

export class PasswordAuthProvider implements OAuthServerProvider {
    private _clientsStore: DatabaseClientsStore;
    private prisma: PrismaClient;

    constructor(prisma: PrismaClient) {
        this._clientsStore = new DatabaseClientsStore(prisma);
        this.prisma = prisma;

        // Initialize clients and register default test client
        this.initializeDefaultClient();
    }

    private async initializeDefaultClient() {
        try {
            // Initialize the client store
            await this._clientsStore.initialize();
        } catch (error) {
            console.error('Error initializing default client:', error);
        }
    }

    get clientsStore(): OAuthRegisteredClientsStore {
        return this._clientsStore;
    }

    /**
     * Begins the authorization flow with password authentication
     */
    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
        try {
            // Redirect to login page with URL parameters instead of rendering template
            const loginUrl = new URL('/auth/login', config.baseUrl);
            loginUrl.searchParams.set('client_id', client.client_id);
            loginUrl.searchParams.set('client_name', client.client_name || 'Unknown Application');
            if (params.state) {
                loginUrl.searchParams.set('state', params.state);
            }
            loginUrl.searchParams.set('code_challenge', params.codeChallenge);
            loginUrl.searchParams.set('redirect_uri', params.redirectUri);
            if (params.scopes && params.scopes.length > 0) {
                loginUrl.searchParams.set('scope', params.scopes.join(' '));
            }

            res.redirect(loginUrl.toString());
        } catch (error) {
            console.error('Authorization error:', error);
            const errorUrl = new URL(params.redirectUri);
            errorUrl.searchParams.set('error', 'server_error');
            errorUrl.searchParams.set('error_description', 'Authorization server error');
            if (params.state) {
                errorUrl.searchParams.set('state', params.state);
            }
            res.redirect(errorUrl.toString());
        }
    }

    /**
     * Handles the login form submission
     */
    async handleLogin(
        email: string,
        password: string,
        clientId: string,
        state: string,
        codeChallenge: string,
        redirectUri: string,
        scopes: string[]
    ): Promise<{ success: boolean; authCode?: string; error?: string }> {
        try {
            // Verify user exists in database and get their hashed password
            const user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                return { success: false, error: 'User not found' };
            }

            if (!user.password) {
                console.error('Password field is null/undefined for user:', email);
                return { success: false, error: 'Password not accessible' };
            }

            // Validate password using bcrypt
            const isPasswordValid = await bcrypt.compare(password, user.password);

            if (!isPasswordValid) {
                return { success: false, error: 'Invalid password' };
            }

            // Generate authorization code
            const authCode = crypto.randomBytes(32).toString('hex');

            // Store authorization code in database
            await this.prisma.authorizationCode.create({
                data: {
                    code: authCode,
                    clientId,
                    userId: user.id,
                    codeChallenge,
                    redirectUri,
                    expiresAt: new Date(Date.now() + 600000), // 10 minutes
                    scopes,
                },
            });

            return { success: true, authCode };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Login failed' };
        }
    }

    /**
     * Returns the code challenge for verification
     */
    async challengeForAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string
    ): Promise<string> {
        const authData = await this.prisma.authorizationCode.findUnique({
            where: { code: authorizationCode },
        });

        if (!authData || authData.clientId !== client.client_id) {
            throw new Error('Invalid authorization code');
        }

        if (Date.now() > authData.expiresAt.getTime()) {
            await this.prisma.authorizationCode.delete({
                where: { code: authorizationCode },
            });
            throw new Error('Authorization code expired');
        }

        return authData.codeChallenge;
    }

    /**
     * Exchanges authorization code for access token
     */
    async exchangeAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string,
        codeVerifier?: string,
        redirectUri?: string
    ): Promise<OAuthTokens> {
        const authData = await this.prisma.authorizationCode.findUnique({
            where: { code: authorizationCode },
        });

        if (!authData || authData.clientId !== client.client_id) {
            throw new Error('Invalid authorization code');
        }

        if (Date.now() > authData.expiresAt.getTime()) {
            await this.prisma.authorizationCode.delete({
                where: { code: authorizationCode },
            });
            throw new Error('Authorization code expired');
        }

        if (redirectUri && authData.redirectUri !== redirectUri) {
            throw new Error('Invalid redirect URI');
        }

        // Verify PKCE if code verifier provided
        if (codeVerifier) {
            const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

            if (challenge !== authData.codeChallenge) {
                throw new Error('Invalid code verifier');
            }
        }

        // Generate tokens
        const accessToken = crypto.randomBytes(32).toString('hex');
        const refreshToken = crypto.randomBytes(32).toString('hex');
        const expiresIn = 3600; // 1 hour
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        // Store tokens in database
        await this.prisma.accessToken.create({
            data: {
                token: accessToken,
                clientId: client.client_id,
                userId: authData.userId,
                scopes: authData.scopes as any,
                expiresAt,
            },
        });

        await this.prisma.refreshToken.create({
            data: {
                token: refreshToken,
                clientId: client.client_id,
                userId: authData.userId,
                scopes: authData.scopes as any,
                expiresAt: new Date(Date.now() + 86400 * 30 * 1000), // 30 days
            },
        });

        // Clean up authorization code
        await this.prisma.authorizationCode.delete({
            where: { code: authorizationCode },
        });

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
            refresh_token: refreshToken,
            scope: (authData.scopes as string[]).join(' '),
        };
    }

    /**
     * Exchanges refresh token for new access token
     */
    async exchangeRefreshToken(
        client: OAuthClientInformationFull,
        refreshToken: string,
        scopes?: string[]
    ): Promise<OAuthTokens> {
        const tokenData = await this.prisma.refreshToken.findUnique({
            where: { token: refreshToken },
        });

        if (!tokenData || tokenData.clientId !== client.client_id) {
            throw new Error('Invalid refresh token');
        }

        if (Date.now() > tokenData.expiresAt.getTime()) {
            await this.prisma.refreshToken.delete({
                where: { token: refreshToken },
            });
            throw new Error('Refresh token expired');
        }

        // Use provided scopes or fall back to original scopes
        const finalScopes = scopes || (tokenData.scopes as string[]);

        // Generate new access token
        const accessToken = crypto.randomBytes(32).toString('hex');
        const newRefreshToken = crypto.randomBytes(32).toString('hex');
        const expiresIn = 3600; // 1 hour
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        // Store new access token
        await this.prisma.accessToken.create({
            data: {
                token: accessToken,
                clientId: client.client_id,
                userId: tokenData.userId,
                scopes: finalScopes,
                expiresAt,
            },
        });

        // Update refresh token (rotate it)
        await this.prisma.refreshToken.delete({
            where: { token: refreshToken },
        });
        await this.prisma.refreshToken.create({
            data: {
                token: newRefreshToken,
                clientId: client.client_id,
                userId: tokenData.userId,
                scopes: finalScopes,
                expiresAt: new Date(Date.now() + 86400 * 30 * 1000), // 30 days
            },
        });

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
            refresh_token: newRefreshToken,
            scope: finalScopes.join(' '),
        };
    }

    /**
     * Verifies access token and returns auth info
     */
    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const tokenData = await this.prisma.accessToken.findUnique({
            where: { token },
        });

        if (!tokenData) {
            throw new Error('Invalid access token');
        }

        if (Date.now() > tokenData.expiresAt.getTime()) {
            await this.prisma.accessToken.delete({
                where: { token },
            });
            throw new Error('Access token expired');
        }

        return {
            token,
            clientId: tokenData.clientId,
            scopes: tokenData.scopes as string[],
            expiresAt: Math.floor(tokenData.expiresAt.getTime() / 1000),
            extra: {
                userId: tokenData.userId,
            },
        };
    }

    /**
     * Revokes access or refresh token
     */
    async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
        const { token, token_type_hint } = request;

        // Try to revoke as access token
        const accessTokenData = await this.prisma.accessToken.findUnique({
            where: { token },
        });
        if (accessTokenData && accessTokenData.clientId === client.client_id) {
            await this.prisma.accessToken.delete({
                where: { token },
            });
            return;
        }

        // Try to revoke as refresh token
        const refreshTokenData = await this.prisma.refreshToken.findUnique({
            where: { token },
        });
        if (refreshTokenData && refreshTokenData.clientId === client.client_id) {
            await this.prisma.refreshToken.delete({
                where: { token },
            });
            return;
        }

        // Token not found or doesn't belong to client - silently succeed per spec
    }
}
