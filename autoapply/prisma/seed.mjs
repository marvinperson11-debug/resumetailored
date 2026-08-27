// Optional dev seed: creates a demo user with a sample resume and one job.
// Run: npm run prisma:generate && node prisma/seed.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL || "demo@autoapply.dev";

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Demo Candidate",
      resumeData: {
        personalInfo: {
          fullName: "Demo Candidate",
          email,
          phone: "+1 555 010 2030",
          location: "Remote (US)",
          linkedin: "https://linkedin.com/in/demo",
          portfolio: "https://demo.dev",
        },
        summary: "Full-stack engineer with 6 years building web apps.",
        workExperience: [
          {
            company: "Globex",
            title: "Senior Software Engineer",
            startDate: "2021",
            endDate: "Present",
            current: true,
            bullets: [
              "Led migration to Next.js, cutting page load 40%.",
              "Shipped a design system adopted by 5 teams.",
            ],
          },
        ],
        education: [{ school: "State University", degree: "BS", field: "Computer Science", endDate: "2018" }],
        skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "Prisma"],
        preferredSalary: "$150,000",
        startDate: "2 weeks notice",
      },
      preferences: { role: "Senior Frontend Engineer", location: "Remote", workMode: "remote", minSalary: 140000 },
    },
  });

  await prisma.jobApplication.create({
    data: {
      userId: user.id,
      companyName: "Acme Corp",
      roleTitle: "Senior Frontend Engineer",
      jobUrl: "https://boards.greenhouse.io/acme/jobs/123456",
      jobDescription:
        "We're hiring a Senior Frontend Engineer with strong React/Next.js and TypeScript. You'll own our design system and improve performance. PostgreSQL experience a plus.",
      status: "NEW",
    },
  });

  console.log(`Seeded ${email}`);
}

main().finally(() => prisma.$disconnect());
