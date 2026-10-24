import { PrismaClient, RoleName, AccountStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { ROLE_DEFINITIONS } from "../src/modules/auth/role-definitions";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

const PILLARS: { slug: string; name: string }[] = [
  { slug: "generation-network", name: "Generation & network" },
  { slug: "last-mile-access", name: "Last-mile access" },
  { slug: "financially-viable-utilities", name: "Financially Viable Utilities" },
  { slug: "private-sector-participation", name: "Private sector" },
  { slug: "regional-integration", name: "Regional integration" },
  { slug: "clean-cooking", name: "Clean cooking" },
];

const STATES: { name: string; zone: string }[] = [
  { name: "Benue", zone: "North Central" },
  { name: "Kogi", zone: "North Central" },
  { name: "Kwara", zone: "North Central" },
  { name: "Nasarawa", zone: "North Central" },
  { name: "Niger", zone: "North Central" },
  { name: "Plateau", zone: "North Central" },
  { name: "Federal Capital Territory", zone: "North Central" },
  { name: "Adamawa", zone: "North East" },
  { name: "Bauchi", zone: "North East" },
  { name: "Borno", zone: "North East" },
  { name: "Gombe", zone: "North East" },
  { name: "Taraba", zone: "North East" },
  { name: "Yobe", zone: "North East" },
  { name: "Jigawa", zone: "North West" },
  { name: "Kaduna", zone: "North West" },
  { name: "Kano", zone: "North West" },
  { name: "Katsina", zone: "North West" },
  { name: "Kebbi", zone: "North West" },
  { name: "Sokoto", zone: "North West" },
  { name: "Zamfara", zone: "North West" },
  { name: "Abia", zone: "South East" },
  { name: "Anambra", zone: "South East" },
  { name: "Ebonyi", zone: "South East" },
  { name: "Enugu", zone: "South East" },
  { name: "Imo", zone: "South East" },
  { name: "Akwa Ibom", zone: "South South" },
  { name: "Bayelsa", zone: "South South" },
  { name: "Cross River", zone: "South South" },
  { name: "Delta", zone: "South South" },
  { name: "Edo", zone: "South South" },
  { name: "Rivers", zone: "South South" },
  { name: "Ekiti", zone: "South West" },
  { name: "Lagos", zone: "South West" },
  { name: "Ogun", zone: "South West" },
  { name: "Ondo", zone: "South West" },
  { name: "Osun", zone: "South West" },
  { name: "Oyo", zone: "South West" },
];

async function main() {
  for (const definition of ROLE_DEFINITIONS) {
    await prisma.roleDefinition.upsert({
      where: { role: definition.role },
      create: definition,
      update: definition,
    });
  }

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "admin@m300.local";
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || "ChangeMe123!";
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      fullName: "System Administrator",
      designation: "System Administrator",
      role: RoleName.SYSTEM_ADMINISTRATOR,
      status: AccountStatus.ACTIVE,
      passwordHash: await argon2.hash(adminPassword),
    },
    update: {},
  });

  for (const pillar of PILLARS) {
    await prisma.pillar.upsert({ where: { slug: pillar.slug }, create: pillar, update: { name: pillar.name } });
  }

  for (const state of STATES) {
    await prisma.state.upsert({ where: { name: state.name }, create: state, update: { zone: state.zone } });
  }

  console.log(`Seed complete: roles, pillars, states and one administrator (${adminEmail}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
