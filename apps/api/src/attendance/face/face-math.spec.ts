import { fakeTemplate } from './fake-face-engine.js';
import { ALIGNED_LANDMARKS, cosine, dropOverlapping, headTurn, normalise, overlap, sharpness, similarityScale, similarityTransform, type Landmarks, type Point } from './face-math.js';
import { TemplateVault } from './template-vault.js';

// The arithmetic behind face matching, with plain numbers. A mistake here would
// not fail loudly; it would make matching quietly worse, or pay the wrong person.

describe('Comparing templates', () => {
  it('makes a template one unit long, and scores it 1 against itself', () => {
    const template = normalise(new Float32Array([3, 4, 0]));
    expect([...template]).toEqual([expect.closeTo(0.6, 5), expect.closeTo(0.8, 5), 0]);
    expect(cosine(template, template)).toBeCloseTo(1, 5);
    expect(cosine(template, normalise(new Float32Array([-4, 3, 0])))).toBeCloseTo(0, 5);
  });

  it('gives the test engine exactly the likeness a test asks for', () => {
    const own = fakeTemplate({ id: 'someone' });
    expect(cosine(own, fakeTemplate({ id: 'someone', like: 0.45 }))).toBeCloseTo(0.45, 4);
    expect(cosine(own, fakeTemplate({ id: 'someone', like: 0.3 }))).toBeCloseTo(0.3, 4);
    // Two different made-up people are far apart.
    expect(Math.abs(cosine(own, fakeTemplate({ id: 'someone-else' })))).toBeLessThan(0.3);
  });
});

describe('Lining a face up', () => {
  const moved = (points: Landmarks, scale: number, angle: number, dx: number, dy: number): Point[] =>
    points.map(([x, y]) => [scale * (x * Math.cos(angle) - y * Math.sin(angle)) + dx, scale * (x * Math.sin(angle) + y * Math.cos(angle)) + dy]);

  it('finds the turn, resize and shift that puts a tilted, larger, off-centre face back in place', () => {
    const inPhoto = moved(ALIGNED_LANDMARKS, 3, 0.3, 400, 250);
    const transform = similarityTransform(inPhoto, ALIGNED_LANDMARKS);
    expect(similarityScale(transform)).toBeCloseTo(1 / 3, 4);
    for (const [index, [x, y]] of inPhoto.entries()) {
      expect(transform.a * x - transform.b * y + transform.tx).toBeCloseTo(ALIGNED_LANDMARKS[index]![0], 3);
      expect(transform.b * x + transform.a * y + transform.ty).toBeCloseTo(ALIGNED_LANDMARKS[index]![1], 3);
    }
  });

  it('changes nothing for a face already in place', () => {
    const transform = similarityTransform(ALIGNED_LANDMARKS, ALIGNED_LANDMARKS);
    expect(transform.a).toBeCloseTo(1, 6);
    expect(transform.b).toBeCloseTo(0, 6);
    expect(transform.tx).toBeCloseTo(0, 4);
    expect(transform.ty).toBeCloseTo(0, 4);
  });
});

describe('How far a head is turned', () => {
  const faceWithNoseAt = (x: number): Landmarks => [[70, 100], [130, 100], [x, 135], [78, 165], [122, 165]];

  it('is about nothing facing the camera, and grows as the nose moves off the middle of the eyes', () => {
    expect(headTurn(faceWithNoseAt(100))).toBeCloseTo(0, 6);
    expect(headTurn(faceWithNoseAt(118))).toBeCloseTo(0.3, 6);
    expect(headTurn(faceWithNoseAt(82))).toBeCloseTo(-0.3, 6);
  });

  it('does not change when the whole face is simply nearer, further or tilted', () => {
    const turned = faceWithNoseAt(118);
    const nearer = turned.map(([x, y]) => [x * 2 + 30, y * 2 + 10]) as unknown as Landmarks;
    const tilted = turned.map(([x, y]) => [x * Math.cos(0.2) - y * Math.sin(0.2), x * Math.sin(0.2) + y * Math.cos(0.2)]) as unknown as Landmarks;
    expect(headTurn(nearer)).toBeCloseTo(0.3, 6);
    expect(headTurn(tilted)).toBeCloseTo(0.3, 6);
  });
});

describe('Boxes and sharpness', () => {
  it('measures how much two boxes overlap, and keeps the surest report of each face', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    expect(overlap(box, box)).toBe(1);
    expect(overlap(box, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(1 / 3, 6);
    expect(overlap(box, { x: 20, y: 20, width: 10, height: 10 })).toBe(0);
    const kept = dropOverlapping(
      [
        { box, score: 0.8 },
        { box: { x: 1, y: 1, width: 10, height: 10 }, score: 0.9 },
        { box: { x: 50, y: 50, width: 10, height: 10 }, score: 0.75 },
      ],
      0.3,
    );
    expect(kept.map((face) => face.score)).toEqual([0.9, 0.75]);
  });

  it('scores a picture with hard edges as sharper than a flat one', () => {
    const flat = new Float32Array(100).fill(120);
    const edges = Float32Array.from({ length: 100 }, (_, at) => ((at % 10) + Math.floor(at / 10)) % 2 === 0 ? 0 : 255);
    expect(sharpness(flat, 10, 10)).toBe(0);
    expect(sharpness(edges, 10, 10)).toBeGreaterThan(1000);
  });
});

describe('The lock on stored templates', () => {
  const template = fakeTemplate({ id: 'someone' });

  it('opens what it locked, and stores nothing readable', () => {
    const vault = new TemplateVault('a-test-key-that-is-long-enough-to-use');
    const sealed = vault.seal(template, 'staff-1');
    expect(sealed.length).toBe(12 + 16 + template.byteLength);
    expect(Buffer.from(sealed).includes(Buffer.from(template.buffer))).toBe(false);
    expect([...vault.open(sealed, 'staff-1')]).toEqual([...template]);
    // The same template locked twice does not look the same, so equal faces cannot be spotted in the database.
    expect(Buffer.from(vault.seal(template, 'staff-1')).equals(Buffer.from(sealed))).toBe(false);
  });

  it('will not open for another person, with another key, or after being altered', () => {
    const vault = new TemplateVault('a-test-key-that-is-long-enough-to-use');
    const sealed = vault.seal(template, 'staff-1');
    expect(() => vault.open(sealed, 'staff-2')).toThrow();
    expect(() => new TemplateVault('another-key-that-is-also-long-enough').open(sealed, 'staff-1')).toThrow();
    const altered = Uint8Array.from(sealed);
    altered[40] = altered[40]! ^ 1;
    expect(() => vault.open(altered, 'staff-1')).toThrow();
  });
});
