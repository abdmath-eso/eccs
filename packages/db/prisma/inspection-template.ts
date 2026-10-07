// The standard ECCS inspection: ten sections and 92 checks taken from the
// founder's document (docs/FSSAI 2026 KITCHEN SAFETY CHECKLIST.docx), kept as
// data in prisma/data/inspection-template.json. English only for now.
//
// Each check carries its marks in `weight`: 2 for an ordinary check and 4 for a
// critical one, the way FSSAI's own hygiene rating checklist marks its
// asterisk (*) questions. A weight of 4 is what tells the app a check is critical.
//
// Loading is safe to repeat: the template is found by its English name and its
// checks by their position (1 to 92), so a reload rewords or re-marks them in
// place. A check dropped from the file is switched off, never deleted, so
// inspections already answered keep their answers.

import { readFileSync } from "node:fs";
import type { PrismaClient } from "../src/index.js";

interface TemplateFile {
  name: string;
  marks: { normal: number; critical: number };
  sections: { number: number; title: string; checks: { code: string; text: string; critical?: boolean }[] }[];
}

const read = (): TemplateFile =>
  JSON.parse(readFileSync(new URL("./data/inspection-template.json", import.meta.url), "utf8")) as TemplateFile;

export async function loadInspectionTemplate(
  prisma: PrismaClient,
): Promise<{ sections: number; checks: number; critical: number; switchedOff: number }> {
  const file = read();

  const existing = await prisma.checklistTemplate.findFirst({
    where: { kind: "INSPECTION", outletId: null, title: { path: ["en"], equals: file.name } },
    select: { id: true },
  });
  const template =
    existing ??
    (await prisma.checklistTemplate.create({
      data: { kind: "INSPECTION", title: { en: file.name } },
      select: { id: true },
    }));
  await prisma.checklistTemplate.update({ where: { id: template.id }, data: { isActive: true } });

  const current = await prisma.checklistItem.findMany({
    where: { templateId: template.id, outletId: null },
    select: { id: true, position: true },
  });
  const byPosition = new Map(current.map((item) => [item.position, item.id]));

  let position = 0;
  let critical = 0;
  for (const section of file.sections) {
    for (const check of section.checks) {
      position += 1;
      if (check.critical) critical += 1;
      const data = {
        position,
        section: section.title,
        label: { en: check.text },
        type: "YES_NO" as const,
        weight: check.critical ? file.marks.critical : file.marks.normal,
        isActive: true,
      };
      const id = byPosition.get(position);
      if (id) await prisma.checklistItem.update({ where: { id }, data });
      else await prisma.checklistItem.create({ data: { templateId: template.id, ...data } });
    }
  }

  const { count } = await prisma.checklistItem.updateMany({
    where: { templateId: template.id, outletId: null, position: { gt: position }, isActive: true },
    data: { isActive: false },
  });
  return { sections: file.sections.length, checks: position, critical, switchedOff: count };
}
