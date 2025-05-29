import { Prisma, PrismaClient } from '@prisma/client';
import { enhance } from '@zenstackhq/runtime';
import express, { Request } from 'express';

const prisma = new PrismaClient();
const app = express();

app.use(express.json());

function getUserId(req: Request) {
    return parseInt(req.header('X-USER-ID')!);
}

// Gets a Prisma client bound to the current user identity
function getPrisma(req: Request) {
    const userId = getUserId(req);
    const user = Number.isNaN(userId) ? undefined : { id: userId };
    return enhance(prisma, { user });
}

app.use((req, res, next) => {
    const userId = req.header('X-USER-ID');
    if (!userId || Number.isNaN(parseInt(userId))) {
        res.status(403).json({ error: 'unauthorized' });
    } else {
        next();
    }
});

app.get(`/post`, async (req, res) => {
    const post = await getPrisma(req).post.findMany({
        include: { author: true },
    });
    res.json(post);
});

const server = app.listen(3000, () =>
    console.log(`
🚀 Server ready at: http://localhost:3000
⭐️ See sample requests: https://github.com/prisma/prisma-examples/blob/latest/orm/express/README.md#using-the-rest-api`)
);
