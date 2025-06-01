import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Demo password hash for "password123"
const passwordHash = bcrypt.hashSync('password123', 12);

const userData: Prisma.UserCreateInput[] = [
    {
        name: 'Alice',
        email: 'alice@prisma.io',
        password: passwordHash,
        posts: {
            create: [
                {
                    title: 'Join the Prisma Discord',
                    content: 'https://pris.ly/discord',
                    published: true,
                },
            ],
        },
    },
    {
        name: 'Nilu',
        email: 'nilu@prisma.io',
        password: passwordHash,
        posts: {
            create: [
                {
                    title: 'Follow Prisma on Twitter',
                    content: 'https://www.twitter.com/prisma',
                    published: true,
                },
            ],
        },
    },
    {
        name: 'Mahmoud',
        email: 'mahmoud@prisma.io',
        password: passwordHash,
        posts: {
            create: [
                {
                    title: 'Ask a question about Prisma on GitHub',
                    content: 'https://www.github.com/prisma/prisma/discussions',
                    published: true,
                },
                {
                    title: 'Prisma on YouTube',
                    content: 'https://pris.ly/youtube',
                },
            ],
        },
    },
];

async function main() {
    console.log(`Start seeding ...`);
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
