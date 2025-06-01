import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { fa } from 'zod/v4/locales';

const prisma = new PrismaClient();

// Demo password hash for "password123"
const passwordHash = bcrypt.hashSync('password123', 12);

const userData: Prisma.UserCreateInput[] = [
    {
        name: 'Alex Chen',
        email: 'alex@zenstack.dev',
        password: passwordHash,
        posts: {
            create: [
                {
                    title: 'Building Model Context Protocol (MCP) Servers with ZenStack',
                    content:
                        'A comprehensive guide showing how to build robust MCP servers using ZenStack, combining type-safe database operations with built-in access control for secure AI agent interactions.',
                    published: true,
                    viewCount: 2547,
                },
                {
                    title: 'Advanced Access Control Patterns in ZenStack',
                    content:
                        'Exploring sophisticated access control patterns in ZenStack, including policy-based controls, dynamic permissions, and team-based access rules for secure application development.',
                    published: true,
                    viewCount: 1823,
                },
                {
                    title: 'Full-Stack Type Safety with ZenStack and tRPC',
                    content:
                        'Achieving end-to-end type safety from database to UI using ZenStack and tRPC, eliminating type safety breaks at API boundaries for better developer experience.',
                    published: true,
                    viewCount: 3421,
                },
                {
                    title: 'AI-Powered Code Generation: The Future of Development',
                    content:
                        'Exploring how AI is transforming software development with intelligent code generation, from current tools like GitHub Copilot to future possibilities in automated programming.',
                    published: true,
                    viewCount: 1205,
                },
                {
                    title: 'Migrating from Prisma to ZenStack: A Step-by-Step Guide',
                    content:
                        'A practical migration guide for existing Prisma users wanting to upgrade to ZenStack for enhanced security, reduced boilerplate, and automatic API generation.',
                    published: false,
                    viewCount: 0,
                },
                {
                    title: 'Building Real-time Applications with ZenStack',
                    content:
                        'How to leverage ZenStack for building modern real-time applications with WebSockets, server-sent events, and live data synchronization.',
                    published: false,
                    viewCount: 0,
                },
                {
                    title: "ZenStack Roadmap 2025: What's Coming Next",
                    content:
                        'Exciting upcoming features in ZenStack including enhanced MCP support, GraphQL integration, multi-database support, and performance improvements planned for 2025.',
                    published: false,
                    viewCount: 0,
                },
            ],
        },
    },
    {
        name: 'Sarah Mitchell',
        email: 'sarah@stripe.com',
        password: passwordHash,
        posts: {
            create: [
                {
                    title: 'Building Payment Systems: Lessons from Stripe',
                    content:
                        'Key lessons learned from building payment infrastructure at scale: the importance of idempotency, graceful failure handling, and security-by-design principles.',
                    published: true,
                    viewCount: 4532,
                },
                {
                    title: 'AI in FinTech: Opportunities and Challenges',
                    content:
                        'Exploring how AI is transforming financial services through fraud detection and risk assessment, while addressing challenges like regulatory compliance and bias prevention.',
                    published: true,
                    viewCount: 2890,
                },
                {
                    title: 'Microservices Architecture at Scale: Payment Platform Design',
                    content:
                        'Designing payment platforms that handle millions of transactions using microservices architecture with proper service boundaries and data consistency strategies.',
                    published: false,
                    viewCount: 0,
                },
                {
                    title: 'The Future of Developer Tools in Financial Services',
                    content:
                        'How developer experience in financial services is evolving with better APIs, improved documentation, and modern tooling for fintech innovation.',
                    published: false,
                    viewCount: 0,
                },
            ],
        },
    },
    {
        name: 'Jordan Kim',
        email: 'jordan@vercel.com',
        password: passwordHash,
        posts: {
            create: [
                {
                    title: "Next.js 15: What's New and Why It Matters",
                    content:
                        'A deep dive into Next.js 15 features including stable Turbopack, improved Server Components, new caching strategies, and migration guidance for existing applications.',
                    published: true,
                    viewCount: 8743,
                },
                {
                    title: 'Building AI-First Applications with Vercel AI SDK',
                    content:
                        'Complete guide to building AI-powered applications using Vercel AI SDK, covering streaming responses, chat interfaces, and real-time AI interactions.',
                    published: true,
                    viewCount: 5621,
                },
                {
                    title: 'Edge Computing: The Next Frontier for Web Apps',
                    content:
                        'How edge computing is revolutionizing web applications by bringing computation closer to users, reducing latency and improving global performance.',
                    published: true,
                    viewCount: 3456,
                },
                {
                    title: 'Full-Stack Development in 2025: Trends and Predictions',
                    content:
                        'Predicting the future of full-stack development including AI-native development, edge-first architecture, and universal type safety across the entire stack.',
                    published: true,
                    viewCount: 2789,
                },
                {
                    title: 'Performance Optimization Techniques for React Apps',
                    content:
                        'Essential React performance optimization strategies including code splitting, memoization, bundle analysis, and best practices for building fast applications.',
                    published: false,
                    viewCount: 0,
                },
            ],
        },
    },
];

async function main() {
    console.log(`Start seeding ...`);
    // Clear existing data
    await prisma.post.deleteMany();
    await prisma.user.deleteMany();
    console.log(`Existing data cleared.`);
    for (const u of userData) {
        const user = await prisma.user.upsert({
            where: { email: u.email },
            create: u,
            update: {
                name: u.name,
                password: u.password, // Ensure password is updated
                // Don't update posts in update operation to avoid conflicts
            },
        });
        console.log(`Created/updated user with id: ${user.id}, email: ${user.email}`);
    }
    console.log(`Seeding finished.`);
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
