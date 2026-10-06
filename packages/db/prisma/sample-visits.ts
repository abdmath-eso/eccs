// Sample past service visits, so the history calendar has completed services
// to show before real visits exist. For each recurring service that has no
// completed visit yet, adds the visits that would have happened over the last
// ten weeks. Safe to run again: it adds nothing the second time.

import type { PrismaClient } from "../src/index.js";

const DAY_MS = 86_400_000;
const LOOK_BACK_DAYS = 70;
const MAX_PER_SERVICE = 3;

export async function addSampleVisits(prisma: PrismaClient): Promise<{ added: number }> {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const schedules = await prisma.serviceSchedule.findMany({
    where: { isActive: true },
    include: { jobs: { select: { status: true, supervisorId: true } } },
  });

  let added = 0;
  for (const schedule of schedules) {
    if (schedule.jobs.some((job) => job.status === "COMPLETED" || job.status === "APPROVED")) continue;
    const supervisorId = schedule.jobs.find((job) => job.supervisorId)?.supervisorId ?? null;

    for (let visit = 1; visit <= MAX_PER_SERVICE; visit++) {
      const date = new Date(schedule.nextDueDate.getTime() - visit * schedule.intervalDays * DAY_MS);
      if (date >= today || date.getTime() < today.getTime() - LOOK_BACK_DAYS * DAY_MS) continue;
      // Done late in the evening, Indian time, after the kitchen closed.
      const finishedAt = new Date(date.getTime() + 18 * 3_600_000);
      await prisma.job.create({
        data: {
          outletId: schedule.outletId,
          serviceTypeId: schedule.serviceTypeId,
          scheduleId: schedule.id,
          scheduledDate: date,
          scheduledSlot: "after closing",
          status: "APPROVED",
          supervisorId,
          technicianNames: ["Sample Technician"],
          completedAt: finishedAt,
          approvedAt: finishedAt,
          notes: "Sample past visit",
        },
      });
      added++;
    }
  }
  return { added };
}
