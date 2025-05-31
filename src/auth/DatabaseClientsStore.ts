import { PrismaClient } from '@prisma/client';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import crypto from 'crypto';

// Database-backed client store with in-memory cache
export class DatabaseClientsStore implements OAuthRegisteredClientsStore {
    private prisma: PrismaClient;
    private clients = new Map<string, OAuthClientInformationFull>();
    private initialized = false;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    private async initializeClients() {
        if (this.initialized) return;

        try {
            console.log('Loading OAuth clients from database...');
            const dbClients = await this.prisma.oAuthClient.findMany();

            for (const client of dbClients) {
                const clientInfo: OAuthClientInformationFull = {
                    client_id: client.client_id,
                    client_secret: client.client_secret || undefined,
                    client_name: client.client_name || undefined,
                    redirect_uris: client.redirect_uris as string[],
                    grant_types: client.grant_types as string[],
                    response_types: client.response_types as string[],
                    scope: client.scope || undefined,
                    client_id_issued_at: client.client_id_issued_at || Math.floor(Date.now() / 1000),
                    client_secret_expires_at: client.client_secret_expires_at || 0,
                };
                this.clients.set(client.client_id, clientInfo);
            }

            console.log(`Loaded ${dbClients.length} OAuth clients from database`);
            this.initialized = true;
        } catch (error) {
            console.error('Error loading clients from database:', error);
            this.initialized = true; // Mark as initialized even on error to prevent infinite retries
        }
    }

    getClient(clientId: string): OAuthClientInformationFull | undefined {
        // Ensure clients are loaded
        if (!this.initialized) {
            // For synchronous call, we return undefined if not initialized
            // The initialization should happen during constructor or startup
            console.warn('Clients not initialized yet, returning undefined for client:', clientId);
            return undefined;
        }
        return this.clients.get(clientId);
    }

    registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
        // Generate client ID and secret if not provided
        const clientInfo: OAuthClientInformationFull = {
            ...client,
            client_id: client.client_id || crypto.randomUUID(),
            client_secret: client.client_secret || crypto.randomBytes(32).toString('hex'),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_secret_expires_at: client.client_secret_expires_at || Math.floor(Date.now() / 1000) + 86400 * 365, // 1 year
        };

        // Store in memory cache
        this.clients.set(clientInfo.client_id, clientInfo);

        // Persist to database asynchronously
        this.persistClientToDatabase(clientInfo).catch((error) => {
            console.error('Error persisting client to database:', error);
            // Remove from memory cache if database persist fails
            this.clients.delete(clientInfo.client_id);
        });

        return clientInfo;
    }

    private async persistClientToDatabase(client: OAuthClientInformationFull): Promise<void> {
        try {
            await this.prisma.oAuthClient.upsert({
                where: { client_id: client.client_id },
                create: {
                    client_id: client.client_id,
                    client_secret: client.client_secret,
                    client_name: client.client_name,
                    redirect_uris: client.redirect_uris as any,
                    grant_types: client.grant_types as any,
                    response_types: client.response_types as any,
                    scope: client.scope,
                    client_id_issued_at: client.client_id_issued_at || Math.floor(Date.now() / 1000),
                    client_secret_expires_at: client.client_secret_expires_at || 0,
                },
                update: {
                    client_secret: client.client_secret,
                    client_name: client.client_name,
                    redirect_uris: client.redirect_uris as any,
                    grant_types: client.grant_types as any,
                    response_types: client.response_types as any,
                    scope: client.scope,
                    client_id_issued_at: client.client_id_issued_at || Math.floor(Date.now() / 1000),
                    client_secret_expires_at: client.client_secret_expires_at || 0,
                },
            });
        } catch (error) {
            console.error('Error persisting client to database:', error);
            throw error;
        }
    }

    // Method to initialize clients from database
    async initialize(): Promise<void> {
        await this.initializeClients();
    }
}
