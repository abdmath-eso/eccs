import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideMatch, FACE_RULES } from '@eccs/shared';
import { cosine, headTurn } from './face-math.js';
import { faceModelsDir, OnnxFaceEngine } from './onnx-face-engine.js';

// The real engine, on real photographs of faces.
//
// This runs only where the model files have been downloaded
// (`pnpm --filter @eccs/api face:models`) AND a folder of test faces exists at
// .work/face-test/imgs/lfw/<Person_Name>/<photo>.jpg (a few people from the
// public "Labeled Faces in the Wild" set; never committed, since they are
// pictures of real people). Anywhere else it is skipped, so the ordinary test
// run needs neither. Every other test uses the fake engine.

const facesDir = resolve(import.meta.dirname, '../../../../../.work/face-test/imgs/lfw');
const manifest = resolve(faceModelsDir(), 'manifest.json');
const modelsHere =
  existsSync(manifest) &&
  (JSON.parse(readFileSync(manifest, 'utf8')) as { models: { file: string }[] }).models.every((model) => existsSync(resolve(faceModelsDir(), model.file)));
const facesHere = existsSync(facesDir) && readdirSync(facesDir).length >= 10;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const percentile = (values: number[], share: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))] ?? NaN;
const round = (value: number) => Math.round(value * 1000) / 1000;

describe.skipIf(!modelsHere)('The real face engine: loading', () => {
  it('loads both models after checking their SHA-256', async () => {
    const engine = await new OnnxFaceEngine().load();
    expect(engine.reason).toBeNull();
    expect(engine.ready).toBe(true);
  });

  it('says a file that is not a picture cannot be read', async () => {
    const engine = await new OnnxFaceEngine().load();
    await expect(engine.analyse(Buffer.from('not a picture'))).rejects.toThrow('could not be read');
  });
});

describe.skipIf(!modelsHere || !facesHere)('The real face engine: telling people apart', () => {
  it(
    'scores photos of the same person well above the threshold and of different people well below it',
    async () => {
      const engine = await new OnnxFaceEngine().load();
      expect(engine.ready).toBe(true);

      const people: { name: string; templates: Float32Array[] }[] = [];
      const timings: number[] = [];
      const sharpnesses: number[] = [];
      const brightnesses: number[] = [];
      const turns: number[] = [];
      let photos = 0;
      let noFace = 0;
      for (const name of readdirSync(facesDir).sort()) {
        const templates: Float32Array[] = [];
        for (const file of readdirSync(resolve(facesDir, name)).sort()) {
          const bytes = readFileSync(resolve(facesDir, name, file));
          const started = performance.now();
          const analysis = await engine.analyse(bytes);
          // These photos are centred on their subject, so the subject is the face nearest the middle.
          const centre = (face: { box: { x: number; y: number; width: number; height: number } }) =>
            Math.hypot(face.box.x + face.box.width / 2 - analysis.width / 2, face.box.y + face.box.height / 2 - analysis.height / 2);
          const face = [...analysis.faces].sort((a, b) => centre(a) - centre(b))[0];
          photos += 1;
          if (!face) {
            noFace += 1;
            continue;
          }
          templates.push(await analysis.embed(face));
          timings.push(performance.now() - started);
          sharpnesses.push(face.sharpness);
          brightnesses.push(face.brightness);
          turns.push(Math.abs(headTurn(face.landmarks)));
        }
        if (templates.length > 0) people.push({ name, templates });
      }

      // Every pair of photos: same person, or two different people.
      const same: number[] = [];
      const different: number[] = [];
      for (let a = 0; a < people.length; a += 1) {
        for (let b = a; b < people.length; b += 1) {
          for (let i = 0; i < people[a]!.templates.length; i += 1) {
            for (let j = a === b ? i + 1 : 0; j < people[b]!.templates.length; j += 1) {
              (a === b ? same : different).push(cosine(people[a]!.templates[i]!, people[b]!.templates[j]!));
            }
          }
        }
      }

      // The attendance case itself: enrol each person with three photos, then show
      // the engine their other photos, and photos of people who are not enrolled.
      const enrolled = people.filter((person) => person.templates.length >= 4).slice(0, 20);
      const strangers = people.filter((person) => !enrolled.includes(person));
      const tally = { own: { MATCH: 0, UNSURE: 0, NO_MATCH: 0, wrongPerson: 0 }, stranger: { MATCH: 0, UNSURE: 0, NO_MATCH: 0 } };
      const identify = (probe: Float32Array) =>
        decideMatch(enrolled.map((person) => ({ who: person.name, score: Math.max(...person.templates.slice(0, 3).map((template) => cosine(template, probe))) })));
      for (const person of enrolled) {
        for (const probe of person.templates.slice(3)) {
          const decision = identify(probe);
          if (decision.best && decision.best.who !== person.name && decision.result === 'MATCH') tally.own.wrongPerson += 1;
          else tally.own[decision.result] += 1;
        }
      }
      for (const person of strangers) for (const probe of person.templates) tally.stranger[identify(probe).result] += 1;

      const report = {
        photos,
        people: people.length,
        noFaceFound: noFace,
        samePersonPairs: { count: same.length, mean: round(mean(same)), lowest: round(Math.min(...same)), p05: round(percentile(same, 0.05)), median: round(percentile(same, 0.5)) },
        differentPeoplePairs: { count: different.length, mean: round(mean(different)), highest: round(Math.max(...different)), p95: round(percentile(different, 0.95)), p999: round(percentile(different, 0.999)) },
        atMatchThreshold: {
          threshold: FACE_RULES.matchThreshold,
          samePersonMissed: round(same.filter((score) => score < FACE_RULES.matchThreshold).length / same.length),
          differentPeopleAccepted: round(different.filter((score) => score >= FACE_RULES.matchThreshold).length / different.length),
        },
        atConfidentThreshold: {
          threshold: FACE_RULES.confidentThreshold,
          samePersonMissed: round(same.filter((score) => score < FACE_RULES.confidentThreshold).length / same.length),
          differentPeopleAccepted: round(different.filter((score) => score >= FACE_RULES.confidentThreshold).length / different.length),
        },
        oneToMany: { enrolled: enrolled.length, strangers: strangers.length, ...tally },
        msPerPhoto: { mean: Math.round(mean(timings)), median: Math.round(percentile(timings, 0.5)), slowest: Math.round(Math.max(...timings)) },
        sharpness: { lowest: Math.round(Math.min(...sharpnesses)), p05: Math.round(percentile(sharpnesses, 0.05)), median: Math.round(percentile(sharpnesses, 0.5)) },
        brightness: { lowest: Math.round(Math.min(...brightnesses)), highest: Math.round(Math.max(...brightnesses)) },
        headTurn: { median: round(percentile(turns, 0.5)), p95: round(percentile(turns, 0.95)) },
      };
      // Set FACE_TEST_REPORT=<path> to keep the figures.
      if (process.env.FACE_TEST_REPORT) writeFileSync(process.env.FACE_TEST_REPORT, JSON.stringify(report, null, 2));

      expect(noFace / photos).toBeLessThan(0.02);
      expect(report.samePersonPairs.mean).toBeGreaterThan(FACE_RULES.matchThreshold + 0.15);
      expect(report.differentPeoplePairs.mean).toBeLessThan(FACE_RULES.matchThreshold - 0.25);
      expect(report.atMatchThreshold.differentPeopleAccepted).toBeLessThan(0.01);
      expect(report.atMatchThreshold.samePersonMissed).toBeLessThan(0.15);
      // Nobody is confidently taken for someone else, and no stranger is confidently let in.
      expect(tally.own.wrongPerson).toBe(0);
      expect(tally.stranger.MATCH).toBe(0);
    },
    300_000,
  );
});
