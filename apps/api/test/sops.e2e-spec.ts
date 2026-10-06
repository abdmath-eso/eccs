// The SOP library. Runs against the local database with the sample seed and
// sample SOPs loaded. Everything it creates has a title starting "E2E" and is
// removed afterwards.

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { env } from './../src/config/env.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const CODES = { kukatpally: 'DECCA-KP6R3T', jubilee: 'SPICE-JH2K7M' };
const PINS = { owner: '3917', chef: '8264', otherManager: '4821' };
const PHONES = { admin: '+919000000001', supervisor: '+919000000003' };
const DEVICE = 'e2e-sops';

type Sop = {
  id: string;
  category: string;
  title: Record<string, string>;
  steps: Record<string, string[]>;
  isCustom: boolean;
  outletId: string | null;
  isPublished: boolean;
  canEdit: boolean;
};

describe('SOP library (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let outletId: string;
  let otherOutletId: string;
  let owner: string;
  let chef: string;
  let otherManager: string;
  let admin: string;
  let supervisor: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const list = async (token: string, forOutlet?: string) =>
    (
      await http()
        .get('/sops')
        .query(forOutlet ? { outletId: forOutlet } : {})
        .set(bearer(token))
        .expect(200)
    ).body as Sop[];
  const create = (token: string, body: Record<string, unknown>) => http().post('/sops').set(bearer(token)).send(body);
  const patch = (token: string, id: string, body: Record<string, unknown>) =>
    http().patch(`/sops/${id}`).set(bearer(token)).send(body);

  async function cleanUp() {
    const db = prisma.client;
    // Copies made from the library by these tests.
    await db.sopTemplate.deleteMany({ where: { outletId, libraryItemId: { not: null } } });
    for (const language of ['en', 'te', 'hi']) {
      await db.sopTemplate.deleteMany({ where: { title: { path: [language], string_starts_with: 'E2E' } } });
    }
    await db.session.deleteMany({ where: { deviceName: DEVICE } });
    await db.linkedDevice.deleteMany({ where: { name: DEVICE } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  }

  async function pinLogin(code: string, pin: string): Promise<string> {
    const phone = await http().post('/auth/device/link').send({ code, deviceName: DEVICE }).expect(200);
    const session = await http().post('/auth/pin/login').send({ deviceToken: phone.body.deviceToken, pin }).expect(200);
    return session.body.token as string;
  }

  async function otpLogin(phone: string): Promise<string> {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const session = await http().post('/auth/otp/verify').send({ phone, code: env.DEV_FIXED_OTP, deviceName: DEVICE }).expect(200);
    return session.body.token as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();

    outletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.kukatpally } })).id;
    otherOutletId = (await prisma.client.outlet.findUniqueOrThrow({ where: { code: CODES.jubilee } })).id;
    owner = await pinLogin(CODES.kukatpally, PINS.owner);
    chef = await pinLogin(CODES.kukatpally, PINS.chef);
    otherManager = await pinLogin(CODES.jubilee, PINS.otherManager);
    admin = await otpLogin(PHONES.admin);
    supervisor = await otpLogin(PHONES.supervisor);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it("shows everyone at a restaurant ECCS's standard SOPs, which they cannot change", async () => {
    await http().get('/sops').query({ outletId }).expect(401);

    const forChef = await list(chef, outletId);
    const standard = forChef.filter((sop) => !sop.isCustom);
    expect(standard.length).toBeGreaterThan(0);
    for (const sop of standard) {
      expect(sop.isPublished).toBe(true);
      expect(sop.canEdit).toBe(false);
      expect(sop.steps.en!.length).toBeGreaterThan(0);
    }

    const forOwner = await list(owner, outletId);
    const [first] = forOwner.filter((sop) => !sop.isCustom);
    expect(first!.canEdit).toBe(false);
    await patch(owner, first!.id, { title: 'E2E hijacked' }).expect(403);
    await http().delete(`/sops/${first!.id}`).set(bearer(owner)).expect(403);
  });

  it('lets the Owner add, change and remove an SOP for their own outlet', async () => {
    const created = await create(owner, {
      outletId,
      category: 'CLEANING',
      title: 'E2E tandoor cleaning',
      steps: ['Let the tandoor cool', '  Brush out the ash  ', 'Wipe the\nrim'],
      language: 'en',
    }).expect(201);
    const sop = created.body as Sop;
    expect(sop).toMatchObject({
      category: 'CLEANING',
      title: { en: 'E2E tandoor cleaning' },
      // Steps are tidied: trimmed, and a line break inside a step becomes a space.
      steps: { en: ['Let the tandoor cool', 'Brush out the ash', 'Wipe the rim'] },
      isCustom: true,
      outletId,
      isPublished: true,
      canEdit: true,
    });

    // The Head Chef can read it but not change it or add their own.
    const forChef = (await list(chef, outletId)).find((entry) => entry.id === sop.id);
    expect(forChef).toMatchObject({ canEdit: false });
    await http().get(`/sops/${sop.id}`).set(bearer(chef)).expect(200);
    await patch(chef, sop.id, { title: 'E2E chef edit' }).expect(403);
    await create(chef, { outletId, category: 'OTHER', title: 'E2E chef sop', steps: ['x'] }).expect(403);

    // Another restaurant neither sees it nor can open it, and cannot add to this outlet.
    expect((await list(otherManager, otherOutletId)).map((entry) => entry.id)).not.toContain(sop.id);
    await http().get(`/sops/${sop.id}`).set(bearer(otherManager)).expect(404);
    await list(otherManager, otherOutletId);
    await http().get('/sops').query({ outletId }).set(bearer(otherManager)).expect(403);
    await create(otherManager, { outletId, category: 'OTHER', title: 'E2E intruder', steps: ['x'] }).expect(403);

    const changed = await patch(owner, sop.id, { category: 'EQUIPMENT', steps: ['Only one step now'], language: 'en' }).expect(200);
    expect(changed.body).toMatchObject({ category: 'EQUIPMENT', title: { en: 'E2E tandoor cleaning' }, steps: { en: ['Only one step now'] } });

    await http().delete(`/sops/${sop.id}`).set(bearer(owner)).expect(204);
    await http().get(`/sops/${sop.id}`).set(bearer(owner)).expect(404);
  });

  it('checks what is sent', async () => {
    const base = { outletId, category: 'CLEANING', title: 'E2E bad', steps: ['A step'] };
    await create(owner, { ...base, steps: [] }).expect(400);
    await create(owner, { ...base, steps: ['   '] }).expect(400);
    await create(owner, { ...base, title: 'x' }).expect(400);
    await create(owner, { ...base, category: 'COOKING' }).expect(400);
    // A restaurant must say which outlet the SOP is for.
    await create(owner, { category: 'CLEANING', title: 'E2E no outlet', steps: ['A step'] }).expect(403);
  });

  it('lets ECCS write standard SOPs, as drafts until published, and translate them', async () => {
    const draft = (await create(admin, { category: 'SAFETY', title: 'E2E knife safety', steps: ['Cut away from you'] }).expect(201)).body as Sop;
    expect(draft).toMatchObject({ isCustom: false, outletId: null, isPublished: false, canEdit: true });

    // A draft is in the console but not in any restaurant's app.
    expect((await list(admin)).map((sop) => sop.id)).toContain(draft.id);
    expect((await list(supervisor)).map((sop) => sop.id)).not.toContain(draft.id);
    expect((await list(owner, outletId)).map((sop) => sop.id)).not.toContain(draft.id);
    await http().get(`/sops/${draft.id}`).set(bearer(owner)).expect(404);

    const translated = await patch(admin, draft.id, {
      title: 'E2E కత్తి భద్రత',
      steps: ['మీకు దూరంగా కోయండి'],
      language: 'te',
      isPublished: true,
    }).expect(200);
    expect(translated.body).toMatchObject({
      isPublished: true,
      title: { en: 'E2E knife safety', te: 'E2E కత్తి భద్రత' },
      steps: { en: ['Cut away from you'], te: ['మీకు దూరంగా కోయండి'] },
    });

    expect((await list(chef, outletId)).map((sop) => sop.id)).toContain(draft.id);
    // Supervisors read standard SOPs but do not write them.
    expect((await list(supervisor)).map((sop) => sop.id)).toContain(draft.id);
    await create(supervisor, { category: 'SAFETY', title: 'E2E by supervisor', steps: ['x'] }).expect(403);

    await http().delete(`/sops/${draft.id}`).set(bearer(admin)).expect(204);
  });

  it('will not delete a standard SOP that checklists are based on', async () => {
    const linked = await prisma.client.sopTemplate.findFirstOrThrow({ where: { checklistTemplates: { some: {} } } });
    await http().delete(`/sops/${linked.id}`).set(bearer(admin)).expect(409);
  });

  describe('the library of ready-made SOPs', () => {
    type Item = { id: string; kind: string; name: string; category: string; section: string; steps: string[]; addedSopId: string | null };
    const search = async (token: string, query: Record<string, string>) =>
      (await http().get('/sops/library').query({ outletId, ...query }).set(bearer(token)).expect(200)).body as Item[];

    it('lists what it holds by category and section', async () => {
      const overview = (await http().get('/sops/library/overview').query({ outletId }).set(bearer(owner)).expect(200)).body as {
        total: number;
        categories: { category: string; count: number; sections: { name: string; count: number }[] }[];
      };
      expect(overview.total).toBeGreaterThan(700);
      expect(overview.categories.reduce((total, entry) => total + entry.count, 0)).toBe(overview.total);
      const recipes = overview.categories.find((entry) => entry.category === 'RECIPES')!;
      expect(recipes.sections.map((section) => section.name)).toContain('Indian - South');
      const cleaning = overview.categories.find((entry) => entry.category === 'CLEANING')!;
      expect(cleaning.sections.map((section) => section.name)).toEqual(['Cleaning & Sanitation', 'Dishwashing & Stewarding']);
    });

    it('finds SOPs by what is typed, the closest name first, and understands everyday words', async () => {
      expect(await search(owner, {})).toEqual([]);

      const chicken = await search(owner, { q: 'butter chicken' });
      expect(chicken[0]).toMatchObject({ name: 'Butter Chicken', kind: 'RECIPE', category: 'RECIPES', section: 'Indian - North' });

      const washing = await search(owner, { q: 'handwash' });
      expect(washing.map((item) => item.name)).toContain('Handwashing');

      // "fridge" is not in any name; the library says "refrigerator" and "refrigerated".
      const fridge = await search(owner, { q: 'fridge' });
      expect(fridge.map((item) => item.name)).toEqual(expect.arrayContaining(['Refrigerated Storage', 'Refrigerator Temperature Monitoring']));

      expect(await search(owner, { q: 'zzzqqq' })).toEqual([]);
    });

    it('browses a category or a section', async () => {
      const pests = await search(owner, { category: 'PEST_CONTROL' });
      expect(pests.map((item) => item.name).sort()).toEqual([
        'Pest Control Records',
        'Pest Inspection',
        'Pest Prevention',
        'Pest Sighting Reporting',
        'Pest Treatment Coordination',
      ]);
      const thai = await search(owner, { section: 'Thai' });
      expect(thai.length).toBe(17);
      for (const item of thai) expect(item).toMatchObject({ category: 'RECIPES', section: 'Thai' });
    });

    it("copies one into the outlet's own SOPs, once, to be changed freely", async () => {
      const [item] = await search(owner, { q: 'restaurant opening' });
      expect(item).toMatchObject({ name: 'Restaurant Opening', addedSopId: null });
      expect(item!.steps.length).toBe(6);
      // Step numbers from the workbook are dropped; the app numbers the steps itself.
      expect(item!.steps[0]).toBe('Complete access/opening security checks.');

      const added = (await http().post(`/sops/library/${item!.id}/add`).set(bearer(owner)).send({ outletId }).expect(201)).body as Sop;
      expect(added).toMatchObject({
        title: { en: 'Restaurant Opening' },
        category: 'MANAGEMENT',
        steps: { en: item!.steps },
        isCustom: true,
        outletId,
        canEdit: true,
      });

      // It now shows as added, and adding again gives back the same copy.
      const again = (await http().get(`/sops/library/${item!.id}`).query({ outletId }).set(bearer(owner)).expect(200)).body as Item;
      expect(again.addedSopId).toBe(added.id);
      const second = await http().post(`/sops/library/${item!.id}/add`).set(bearer(owner)).send({ outletId }).expect(201);
      expect(second.body.id).toBe(added.id);

      // It is the restaurant's own: staff see it, and the Owner can reword it.
      expect((await list(chef, outletId)).map((sop) => sop.id)).toContain(added.id);
      const reworded = await patch(owner, added.id, { steps: ['Unlock and switch on the lights', 'Check the gas'], language: 'en' }).expect(200);
      expect(reworded.body.steps.en).toEqual(['Unlock and switch on the lights', 'Check the gas']);

      // Deleting the copy makes the library SOP available to add again.
      await http().delete(`/sops/${added.id}`).set(bearer(owner)).expect(204);
      const after = (await http().get(`/sops/library/${item!.id}`).query({ outletId }).set(bearer(owner)).expect(200)).body as Item;
      expect(after.addedSopId).toBeNull();
    });

    it('is for the Owner and Manager of the outlet only', async () => {
      const [item] = await search(owner, { q: 'handwashing' });
      await http().get('/sops/library').query({ outletId, q: 'cleaning' }).set(bearer(chef)).expect(403);
      await http().get('/sops/library/overview').query({ outletId }).set(bearer(chef)).expect(403);
      await http().get('/sops/library').query({ outletId, q: 'cleaning' }).set(bearer(otherManager)).expect(403);
      await http().post(`/sops/library/${item!.id}/add`).set(bearer(otherManager)).send({ outletId }).expect(403);
      await http().get('/sops/library').query({ q: 'cleaning' }).set(bearer(owner)).expect(400);
      await http().post('/sops/library/made-up/add').set(bearer(owner)).send({ outletId }).expect(404);
    });
  });

  it('gives the standard list only to ECCS when no outlet is named', async () => {
    await http().get('/sops').set(bearer(owner)).expect(403);
  });
});
