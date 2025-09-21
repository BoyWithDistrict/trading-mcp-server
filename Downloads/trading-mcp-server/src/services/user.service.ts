import prisma from './prisma';

const DEMO_EMAIL = 'demo@local';

export async function getOrCreateDemoUserId(): Promise<string> {
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({ data: { email: DEMO_EMAIL, name: 'Demo' } });
  }
  return user.id;
}
