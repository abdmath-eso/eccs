import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, StyleSheet, View } from 'react-native';
import type { Image } from 'react-native-nitro-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, type CameraRef } from 'react-native-vision-camera';
import { createFaceDetectorOutput, transformFacesToPreviewCoordinates, type Face } from 'react-native-vision-camera-face-detector';

import { DirectionView } from '@/components/direction-view';
import { INK, shrink, START_TIMEOUT_MS, SURROUND, type FaceShot, type FaceSweep, type RawPhoto } from '@/components/face-capture-shared';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

// The camera that follows the face.
//
// There is no shutter, no countdown and no "photo 1 of 2" here. The front
// camera runs live, Google's ML Kit finds the face in the picture ON THE PHONE
// several times a second, and this screen does the rest by itself:
//
//  - Clocking in: one line of text says what is wrong ("Move closer", "Centre
//    your face"...). When one face is in the circle, facing the camera and
//    still, the circle "locks" and a picture is kept silently. The line then
//    asks for a small turn of the head, and the moment the turn is seen a
//    second picture is kept. Both go to the server, which decides who it is.
//  - Adding a face: one continuous session, the way a phone's own face unlock
//    is set up. The person moves their head slowly in a circle; each time the
//    head passes through a pose still needed (straight, each side, up, down)
//    the marks on that side of the ring fill in and a picture is kept.
//
// The pattern is the one identity checks use with an ordinary front camera
// (Incode, Persona, Onfido: automatic capture as the main way, a manual button
// only as a fallback) and, for adding a face, Apple's Face ID set-up ("move
// your head slowly to complete the circle").
//
// What this is NOT: Face ID. An iPhone has a depth sensor that measures the
// shape of the face; this phone has an ordinary camera. What is matched here is
// the experience (live following, guided movement, pictures taken by
// themselves). Who the person is, and whether a real head turned, is still
// decided by the server from the pictures.
//
// The pictures are grabbed from the picture on the screen (a "snapshot"), not
// taken as photos: that makes no shutter sound, fires no flash, and is instant,
// so the picture kept is the very moment the pose was seen.
//
// Nobody has yet watched this on a real phone. Every number below is a
// reasoned first choice, to be tuned by trying it in a kitchen.

// ───────────────────────── The numbers ─────────────────────────

/** The face is looked at this often, in milliseconds. ML Kit runs faster; ten times a second is plenty and keeps a cheap phone cool. */
const SAMPLE_MS = 100;
/** Clocking in: the face must be in place and still for this long before the circle locks. Long enough to be a held pose, short enough not to feel like waiting. */
const STEADY_MS = 400;
/** A face narrower than this share of the circle is too far away. At this size the face is still about 160 pixels wide in the saved photo; the server needs 80. */
const FACE_MIN = 0.45;
/** A face wider than the circle is too close: the chin or forehead would be cut off. */
const FACE_MAX = 1.0;
/** Faces smaller than this share of the circle are people in the background, and are ignored. */
const BACKGROUND_FACE = 0.3;
/** How far the middle of the face may sit from the middle of the circle, as a share of the circle, across and up-and-down. */
const CENTRE_X = 0.18;
const CENTRE_Y = 0.2;
/** While the head is being moved round, the face slides about; the centring rule is looser then. */
const CENTRE_LOOSE = 0.32;
/** "Facing the camera": the head turned sideways by no more than this many degrees, */
const FRONT_YAW = 10;
/** nodded up or down by no more than this (a phone is often held a little low), */
const FRONT_PITCH = 12;
/** and tilted towards a shoulder by no more than this. */
const FRONT_ROLL = 15;
/** Both eyes must look open with at least this likelihood (0 to 1). Low on purpose: glasses confuse this reading. */
const EYES_OPEN = 0.3;
/** "Still" means the face moved less than this share of the circle, */
const STILL_SHIFT = 0.06;
/** and the head turned less than this many degrees, since the moment it came into place. */
const STILL_DEGREES = 6;
/**
 * Clocking in: how many degrees the head must turn before the second picture.
 * The server's own check (FACE_RULES.livenessMinTurn, 0.12) measures how far
 * the nose tip moves sideways from the middle of the eyes, as a share of the
 * distance between the eyes. The nose tip stands out from the eyes by roughly
 * 0.4 of that distance, so the measure is about 0.4 x tan(turn): 0.12 needs
 * about 17 degrees. 25 degrees gives about 0.19, half as much again as the
 * server asks for, and is still an easy, small turn.
 */
const TURN_DEGREES = 25;
/** After the turn is seen, the picture waits until the head stops (so it is not blurred), but no longer than this. */
const TURN_SETTLE_MS = 500;
/** No turn seen in this long: the first picture goes alone, and the server simply skips its turn check. Nobody is trapped. */
const TURN_TIMEOUT_MS = 4000;
/** Clocking in: "Take photo instead" appears after this long without a lock. */
const MANUAL_AFTER_MS = 8000;
/** Adding a face: a pose to one side counts from this many degrees of turn, */
const SIDE_YAW = 15;
/** up to this many. Beyond it the far eye starts to disappear and the server may not see the same person. */
const SIDE_YAW_MAX = 32;
/** Looking up or down counts from this many degrees of nod, */
const NOD_PITCH = 10;
/** up to this many. */
const NOD_PITCH_MAX = 28;
/** Adding a face: at least this long between two pictures. */
const GRAB_GAP_MS = 350;
/** Adding a face: after this long with no new pose, the line names a direction that is still missing. */
const NUDGE_MS = 5000;
/** Adding a face: after this long, three pictures (the server's minimum) are enough to finish. */
const SWEEP_LATE_MS = 20000;
/** The "done" tick stays up at least this long, so it is seen. */
const DONE_SHOW_MS = 700;
/** How many marks the ring round the circle has. */
const TICKS = 48;
/**
 * The picture grabbed from the screen is a mirror image, because the screen
 * shows the front camera like a mirror. It is flipped back before it is saved,
 * so the photo the Owner sees shows the person the way others see them. If
 * saved photos ever come out reversed (text on a shirt reads backwards), set
 * this to false.
 */
const SNAPSHOT_IS_MIRRORED = true;

// ───────────────────────── What the detector saw ─────────────────────────

/** One face, in the screen's own measurements. */
interface Seen {
  /** The middle of the face. */
  x: number;
  y: number;
  width: number;
  /** Degrees. Sideways turn, nod (up is positive), and tilt towards a shoulder. */
  yaw: number;
  pitch: number;
  roll: number;
  /** How likely the less open eye is to be open, 0 to 1. Null when the detector cannot say. */
  eyes: number | null;
}

/** Where the circle is on the screen. */
interface Circle {
  x: number;
  y: number;
  size: number;
  viewWidth: number;
}

type Problem = 'none' | 'many' | 'closer' | 'back' | 'centre' | 'straight';
/** The poses collected when adding a face. `left` and `right` are sides of the SCREEN. */
type Pose = 'straight' | 'up' | 'down' | 'left' | 'right';
type Hint = Problem | 'ok' | 'position' | 'move' | 'up' | 'down' | 'side' | 'otherSide';

const HINT_TEXT: Record<Hint, MessageKey> = {
  none: 'clock.look',
  many: 'face.track.many',
  closer: 'face.track.closer',
  back: 'face.track.back',
  centre: 'face.track.centre',
  straight: 'face.track.straight',
  ok: 'face.live.hold',
  position: 'face.sweep.position',
  move: 'face.sweep.move',
  up: 'face.sweep.up',
  down: 'face.sweep.down',
  side: 'face.sweep.side',
  otherSide: 'face.sweep.otherSide',
};

const ALL_POSES: Pose[] = ['straight', 'up', 'down', 'left', 'right'];

/** Is the face where a picture can be taken? Says what is wrong in the order a person can fix it. */
function judge(faces: Seen[], circle: Circle, needFront: boolean, loose: boolean): { problem: Problem | null; face: Seen | null } {
  if (faces.length === 0) return { problem: 'none', face: null };
  const near = faces.filter((face) => face.width >= circle.size * BACKGROUND_FACE);
  if (near.length > 1) return { problem: 'many', face: null };
  const face = near[0];
  // Only small faces: someone is there, but too far away.
  if (!face) return { problem: 'closer', face: null };
  const share = face.width / circle.size;
  if (share < FACE_MIN) return { problem: 'closer', face };
  if (share > FACE_MAX) return { problem: 'back', face };
  const across = Math.abs(face.x - circle.x) / circle.size;
  const down = Math.abs(face.y - circle.y) / circle.size;
  if (across > (loose ? CENTRE_LOOSE : CENTRE_X) || down > (loose ? CENTRE_LOOSE : CENTRE_Y)) return { problem: 'centre', face };
  if (needFront) {
    const turned = Math.abs(face.yaw) > FRONT_YAW || Math.abs(face.pitch) > FRONT_PITCH || Math.abs(face.roll) > FRONT_ROLL;
    if (turned || (face.eyes !== null && face.eyes < EYES_OPEN)) return { problem: 'straight', face };
  }
  return { problem: null, face };
}

/** Has the face moved since `before`? */
function moved(before: Seen, now: Seen, circle: Circle): boolean {
  return (
    Math.abs(now.x - before.x) > circle.size * STILL_SHIFT ||
    Math.abs(now.y - before.y) > circle.size * STILL_SHIFT ||
    Math.abs(now.width - before.width) > before.width * 0.1 ||
    Math.abs(now.yaw - before.yaw) > STILL_DEGREES ||
    Math.abs(now.pitch - before.pitch) > STILL_DEGREES
  );
}

/**
 * Which pose the head is in, if any. ML Kit counts a turn towards the person's
 * own left as positive; on a screen that works like a mirror that is the left
 * side of the screen. (Not yet seen on a phone: if the marks fill on the wrong
 * side, swap 'left' and 'right' here. All five are collected either way.)
 */
function poseOf(face: Seen): Pose | null {
  const yaw = Math.abs(face.yaw);
  const pitch = Math.abs(face.pitch);
  if (yaw <= FRONT_YAW && pitch <= FRONT_PITCH) return 'straight';
  if (yaw >= SIDE_YAW && yaw <= SIDE_YAW_MAX && pitch <= SIDE_YAW) return face.yaw > 0 ? 'left' : 'right';
  if (pitch >= NOD_PITCH && pitch <= NOD_PITCH_MAX && yaw <= SIDE_YAW) return face.pitch > 0 ? 'up' : 'down';
  return null;
}

/** Which side of the ring a mark belongs to, from its angle (0 is the top, clockwise). */
function sideOf(angle: number): Pose {
  if (angle >= 315 || angle < 45) return 'up';
  if (angle < 135) return 'right';
  if (angle < 225) return 'down';
  return 'left';
}

/** Deletes a working file, quietly. */
function forget(uri: string | null | undefined) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // Already gone, or not ours to delete: the phone clears this folder by itself.
  }
}

/**
 * Where the detector's answers go: the screen that is open now. Only one face
 * camera is ever open at a time. (A plain variable and not something inside
 * the screen, because the detector is made while the screen is being drawn
 * and may only be given things that are safe to read at that moment.)
 */
let listener: ((faces: Face[]) => void) | null = null;

// ───────────────────────── The screen ─────────────────────────

interface TrackedFaceCameraProps {
  /** 'clock': two pictures to clock in or out. 'enrolSweep': three to five, to add a face. */
  purpose: 'clock' | 'enrolSweep';
  onCaptured?: (shot: FaceShot) => void;
  onSwept?: (sweep: FaceSweep) => void;
  onCancel: () => void;
  /** This camera could not start, or stopped working: whoever shows it falls back to the countdown camera. */
  onUnavailable: () => void;
}

export function TrackedFaceCamera({ purpose, onCaptured, onSwept, onCancel, onUnavailable }: TrackedFaceCameraProps) {
  const theme = useTheme();
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, readPermission] = useCameraPermissions();
  const [root, setRoot] = useState<{ width: number; height: number } | null>(null);
  // Where the room left for the circle sits on the screen, once it has been laid out.
  const [space, setSpace] = useState<{ y: number; height: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [inFront, setInFront] = useState(true);
  const [hint, setHint] = useState<Hint>(purpose === 'clock' ? 'none' : 'position');
  // Clocking in: the first picture is being kept or has been kept.
  const [locked, setLocked] = useState(false);
  // Clocking in: the first picture is kept, and the head turn is being waited for.
  const [turning, setTurning] = useState(false);
  const [manual, setManual] = useState(false);
  // Adding a face: the poses collected so far.
  const [got, setGot] = useState<Pose[]>([]);
  // Adding a face: the time allowed has passed.
  const [late, setLate] = useState(false);
  const [finished, setFinished] = useState(false);

  const camera = useRef<CameraRef>(null);
  const circle = useRef<Circle | null>(null);
  // Everything the screen keeps track of between two looks at the face. Kept
  // out of React's state on purpose: it changes ten times a second and nothing
  // on screen depends on it directly.
  const track = useRef({
    ready: false,
    // A picture is being grabbed: the next look waits.
    busy: false,
    // The work is over (pictures handed back, or the camera gave up).
    done: false,
    lastLook: 0,
    // Clocking in.
    phase: 'seek' as 'seek' | 'turn',
    inPlace: null as { at: number; face: Seen } | null,
    firstYaw: 0,
    first: null as RawPhoto | null,
    turnSeenAt: null as number | null,
    lastYaw: 0,
    turnTimer: null as ReturnType<typeof setTimeout> | null,
    // Adding a face.
    shots: new Map<Pose, RawPhoto>(),
    before: null as { at: number; face: Seen } | null,
    stillFor: 0,
    lastGrab: 0,
    lastProgress: 0,
    late: false,
  });

  // The newest callbacks, kept where a late answer from the camera can find them.
  const callbacks = useRef({ onCaptured, onSwept, onCancel, onUnavailable });
  useEffect(() => {
    callbacks.current = { onCaptured, onSwept, onCancel, onUnavailable };
  });

  // False once this has left the screen, so nothing is done after that.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
    const state = track.current;
    return () => {
      shown.current = false;
      if (state.turnTimer) clearTimeout(state.turnTimer);
      // Pictures that were grabbed but never handed back (the person pressed Cancel).
      if (!state.done) {
        forget(state.first?.uri);
        for (const shot of state.shots.values()) forget(shot.uri);
      }
    };
  }, []);

  // ── Permission ──
  const granted = permission?.granted === true;
  const refused = permission?.status === PermissionStatus.DENIED;
  const canAsk = permission !== null && !permission.granted && permission.canAskAgain;
  const asked = useRef(false);
  useEffect(() => {
    if (!canAsk || asked.current) return;
    asked.current = true;
    requestPermission().catch(() => undefined);
  }, [canAsk, requestPermission]);

  // Leaving the app stops the camera; coming back starts it again and looks again at whether the camera is allowed.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setInFront(state === 'active');
      if (state === 'active') void readPermission().catch(() => undefined);
    });
    return () => listener.remove();
  }, [readPermission]);

  // ── The circle ──
  // As wide as the screen allows, leaving room for the ring of marks round it.
  const size = root && space ? Math.max(120, Math.min(root.width * 0.72, MaxContentWidth * 0.72, space.height - 72)) : 0;
  const centre = space ? space.y + space.height / 2 : 0;
  const rootWidth = root?.width ?? 0;
  useEffect(() => {
    circle.current = size > 0 && rootWidth > 0 ? { x: rootWidth / 2, y: centre, size, viewWidth: rootWidth } : null;
  }, [size, centre, rootWidth]);

  /** Gives up on this camera; whoever showed it falls back to the countdown camera. */
  function giveUp() {
    const state = track.current;
    if (state.done || !shown.current) return;
    state.done = true;
    callbacks.current.onUnavailable();
  }

  /**
   * Keeps the picture that is on the screen right now: silently, with no
   * flash. Only the part round the circle is kept, which leaves out people in
   * the background and makes the face larger in the saved photo.
   */
  async function grab(): Promise<RawPhoto> {
    const view = camera.current;
    const ring = circle.current;
    if (!view || !ring) throw new Error('The camera is not ready');
    const made: Image[] = [];
    try {
      const whole = await view.takeSnapshot();
      made.push(whole);
      // The picture is in the screen's own dots; the circle is measured in layout units.
      const scale = whole.width / ring.viewWidth;
      const halfWidth = Math.min(ring.x, ring.size * 0.85);
      const cut = await whole.cropAsync(
        Math.max(0, Math.round((ring.x - halfWidth) * scale)),
        Math.max(0, Math.round((ring.y - ring.size) * scale)),
        Math.min(whole.width, Math.round((ring.x + halfWidth) * scale)),
        Math.min(whole.height, Math.round((ring.y + ring.size) * scale)),
      );
      made.push(cut);
      let upright = cut;
      if (SNAPSHOT_IS_MIRRORED) {
        upright = await cut.mirrorHorizontallyAsync();
        made.push(upright);
      }
      const path = await upright.saveToTemporaryFileAsync('jpg', 92);
      return { uri: path.startsWith('file://') ? path : `file://${path}`, width: upright.width, height: upright.height };
    } finally {
      // Each of these holds a whole uncompressed picture: let go of them at once, a cheap phone has little memory.
      for (const image of made) {
        try {
          image.dispose();
        } catch {
          // Already let go.
        }
      }
    }
  }

  // ── Clocking in ──

  /** Shrinks the pictures and hands them back. `second` is missing when no head turn was seen. */
  async function finishClock(first: RawPhoto, second: RawPhoto | null) {
    const state = track.current;
    if (state.done) return;
    state.done = true;
    if (state.turnTimer) clearTimeout(state.turnTimer);
    setFinished(true);
    try {
      const main = await shrink(first);
      const turned = second ? await shrink(second) : null;
      forget(first.uri);
      forget(second?.uri);
      if (!shown.current) return;
      callbacks.current.onCaptured?.({ ...main, ...(turned && { turned: turned.photo }) });
    } catch {
      if (shown.current) callbacks.current.onUnavailable();
    }
  }

  /** The circle has locked: keep the first picture, then wait for the turn. */
  async function keepFirst(yaw: number) {
    const state = track.current;
    state.busy = true;
    state.phase = 'turn';
    state.firstYaw = yaw;
    setLocked(true);
    try {
      state.first = await grab();
      if (!shown.current) return;
      setTurning(true);
      state.turnTimer = setTimeout(() => {
        // No turn seen in time. If the second picture is being grabbed right now, that finishes it instead.
        if (!state.busy && state.first) void finishClock(state.first, null);
      }, TURN_TIMEOUT_MS);
    } catch {
      giveUp();
    } finally {
      state.busy = false;
    }
  }

  async function keepSecond() {
    const state = track.current;
    if (!state.first) return;
    state.busy = true;
    try {
      const second = await grab();
      void finishClock(state.first, second);
    } catch {
      // The first picture is enough to go on with.
      void finishClock(state.first, null);
    } finally {
      state.busy = false;
    }
  }

  /** "Take photo instead": one picture, now, whatever the detector thinks. */
  async function takeNow() {
    const state = track.current;
    if (state.busy || state.done || !state.ready || state.first) return;
    state.busy = true;
    setLocked(true);
    try {
      const picture = await grab();
      void finishClock(picture, null);
    } catch {
      giveUp();
    } finally {
      state.busy = false;
    }
  }

  function lookForClock(faces: Seen[], ring: Circle, now: number) {
    const state = track.current;
    if (state.phase === 'seek') {
      const { problem, face } = judge(faces, ring, true, false);
      setHint(problem ?? 'ok');
      if (problem || !face) {
        state.inPlace = null;
        return;
      }
      // In place. Now it must stay there, still, for a moment.
      if (!state.inPlace || moved(state.inPlace.face, face, ring)) {
        state.inPlace = { at: now, face };
        return;
      }
      if (now - state.inPlace.at >= STEADY_MS) void keepFirst(face.yaw);
      return;
    }
    // Waiting for the head to turn. The largest face is the person; anyone behind is ignored.
    const face = [...faces].sort((a, b) => b.width - a.width)[0];
    if (!face || !state.first) return;
    const turn = Math.abs(face.yaw - state.firstYaw);
    if (state.turnSeenAt === null) {
      if (turn >= TURN_DEGREES) {
        state.turnSeenAt = now;
        state.lastYaw = face.yaw;
      }
      return;
    }
    // The turn has been seen. Wait for the head to stop, so the picture is sharp, but not for long.
    const stopped = Math.abs(face.yaw - state.lastYaw) <= STILL_DEGREES;
    state.lastYaw = face.yaw;
    if (turn >= TURN_DEGREES && (stopped || now - state.turnSeenAt >= TURN_SETTLE_MS)) void keepSecond();
  }

  // ── Adding a face ──

  /** Shrinks the pictures, the straight one first, and hands them back. */
  async function finishSweep() {
    const state = track.current;
    if (state.done) return;
    state.done = true;
    setFinished(true);
    const began = Date.now();
    try {
      const photos: FaceSweep['photos'] = [];
      const uris: string[] = [];
      // A Map keeps the order things were put in, and the straight pose is always the first.
      for (const raw of state.shots.values()) {
        const small = await shrink(raw);
        forget(raw.uri);
        photos.push(small.photo);
        uris.push(small.uri);
      }
      const shownFor = Date.now() - began;
      if (shownFor < DONE_SHOW_MS) await new Promise((resolve) => setTimeout(resolve, DONE_SHOW_MS - shownFor));
      if (!shown.current) return;
      callbacks.current.onSwept?.({ photos, uris });
    } catch {
      if (shown.current) callbacks.current.onUnavailable();
    }
  }

  async function keepPose(pose: Pose, now: number) {
    const state = track.current;
    state.busy = true;
    try {
      state.shots.set(pose, await grab());
      state.lastGrab = now;
      state.lastProgress = now;
      if (!shown.current) return;
      setGot([...state.shots.keys()]);
      const count = state.shots.size;
      if (count === ALL_POSES.length || (state.late && count >= 3)) void finishSweep();
    } catch {
      giveUp();
    } finally {
      state.busy = false;
    }
  }

  function lookForSweep(faces: Seen[], ring: Circle, now: number) {
    const state = track.current;
    const started = state.shots.has('straight');
    // The first picture is the one looking straight at the camera, as when clocking in.
    const { problem, face } = judge(faces, ring, !started, started);
    if (problem || !face) {
      // Before anything is collected, the opening instruction says it better than "Look at the camera" or "Look straight".
      setHint(!problem || (!started && (problem === 'none' || problem === 'straight')) ? 'position' : problem);
      state.before = null;
      state.stillFor = 0;
      return;
    }
    // Sharp pictures only: the head must be moving slowly between two looks.
    const slow = state.before !== null && now - state.before.at < SAMPLE_MS * 4 && !moved(state.before.face, face, ring);
    state.stillFor = slow ? state.stillFor + 1 : 0;
    state.before = { at: now, face };

    const pose = poseOf(face);
    // The straight pose is held for three looks in a row; the others are caught in passing.
    const steadyEnough = state.stillFor >= (pose === 'straight' ? 3 : 1);
    if (pose && !state.shots.has(pose) && (started || pose === 'straight') && steadyEnough && now - state.lastGrab >= GRAB_GAP_MS) {
      void keepPose(pose, now);
    }

    if (!started) return setHint('position');
    // Moving nicely: say only "move your head in a circle". Stuck for a while, or out of time: name what is missing.
    if (!state.late && now - state.lastProgress < NUDGE_MS) return setHint('move');
    if (!state.shots.has('up')) return setHint('up');
    if (!state.shots.has('down')) return setHint('down');
    const sides = Number(state.shots.has('left')) + Number(state.shots.has('right'));
    setHint(sides === 0 ? 'side' : 'otherSide');
  }

  // ── From the detector to the two functions above ──

  function look(found: Face[]) {
    const state = track.current;
    const now = Date.now();
    // The cheap checks come first: this is called for every picture the camera makes.
    if (!state.ready || state.done || state.busy || now - state.lastLook < SAMPLE_MS) return;
    const view = camera.current;
    const ring = circle.current;
    if (!view || !ring) return;
    state.lastLook = now;
    let faces: Seen[];
    try {
      // The detector measures in the camera's own picture; this turns its
      // answer into places on this screen (mirrored, and cut the way the
      // screen cuts the picture), so it can be compared with the circle.
      faces = (found.length ? transformFacesToPreviewCoordinates(found, view) : []).map((face) => {
        const eyes = [face.leftEyeOpenProbability, face.rightEyeOpenProbability].filter((value): value is number => typeof value === 'number');
        return {
          x: face.bounds.x + face.bounds.width / 2,
          y: face.bounds.y + face.bounds.height / 2,
          width: face.bounds.width,
          yaw: face.yawAngle,
          pitch: face.pitchAngle,
          roll: face.rollAngle,
          eyes: eyes.length ? Math.min(...eyes) : null,
        };
      });
    } catch {
      // The picture on screen is not ready to be measured yet: try the next one.
      return;
    }
    if (purpose === 'clock') lookForClock(faces, ring, now);
    else lookForSweep(faces, ring, now);
  }

  // The newest functions, for the detector and the timers to call.
  const latest = useRef({ look, giveUp, finishSweep });
  useEffect(() => {
    latest.current = { look, giveUp, finishSweep };
  });
  useEffect(() => {
    const mine = (faces: Face[]) => latest.current.look(faces);
    listener = mine;
    return () => {
      if (listener === mine) listener = null;
    };
  }, []);

  // The part that finds faces, made once and handed to the camera. Set for
  // speed on a phone with little memory: the fast model, no outlines of the
  // features, no following of faces from picture to picture, and the smaller
  // preview picture rather than the full one. "Classifications" (are the eyes
  // open?) stays on: it is cheap, and without it ML Kit's fast model does not
  // report which way the head is turned.
  const [outputs] = useState(() => [
    createFaceDetectorOutput({
      performanceMode: 'fast',
      runClassifications: true,
      runLandmarks: false,
      runContours: false,
      trackingEnabled: false,
      minFaceSize: 0.15,
      cameraFacing: 'front',
      mirrorMode: 'on',
      autoMode: true,
      outputResolution: 'preview',
      onFacesDetected: (faces) => listener?.(faces),
      // One picture the detector could not read does not matter; the next one comes at once.
      onError: () => undefined,
    }),
  ]);

  // A camera that has not started in good time: fall back.
  const starting = granted && !ready;
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => latest.current.giveUp(), START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [starting]);

  // Clocking in: the manual button, only after a while without a lock.
  const seeking = purpose === 'clock' && ready && !locked;
  useEffect(() => {
    if (!seeking) return;
    const timer = setTimeout(() => setManual(true), MANUAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [seeking]);

  // Adding a face: when the time allowed has passed, three pictures are enough.
  const sweeping = purpose === 'enrolSweep' && ready;
  useEffect(() => {
    if (!sweeping) return;
    const timer = setTimeout(() => {
      const state = track.current;
      state.late = true;
      setLate(true);
      if (!state.busy && state.shots.size >= 3) void latest.current.finishSweep();
    }, SWEEP_LATE_MS);
    return () => clearTimeout(timer);
  }, [sweeping]);

  function previewStarted() {
    const state = track.current;
    state.ready = true;
    state.lastProgress = Date.now();
    setReady(true);
  }

  const label = t(purpose === 'clock' ? 'face.capture.clock' : 'face.capture.enrol');
  const line = !ready
    ? t('face.openingCamera')
    : finished && purpose === 'enrolSweep'
      ? t('face.sweep.done')
      : turning && !finished
        ? t('face.live.turn')
        : locked
          ? t('face.track.locked')
          : t(HINT_TEXT[hint]);
  // The circle's own line goes thick once the picture looking straight at the camera is kept.
  const strong = locked || got.includes('straight') || finished;
  // The surround is one very large ring with the circle as its hole, wide enough to reach every corner of the screen.
  const rim = root ? Math.max(root.width, root.height) : 0;

  return (
    <Modal visible animationType="fade" onRequestClose={onCancel}>
      {granted ? (
        <DirectionView
          style={styles.root}
          accessibilityLabel={label}
          onLayout={(event) => setRoot({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
          <Camera
            ref={camera}
            style={StyleSheet.absoluteFill}
            device="front"
            isActive={inFront && !finished}
            outputs={outputs}
            // Shown like a mirror, which is what people expect of a front camera.
            mirrorMode="on"
            resizeMode="cover"
            // The kind of camera picture that can be copied off the screen (see `grab`) and drawn over reliably.
            implementationMode="compatible"
            onPreviewStarted={previewStarted}
            onError={giveUp}
          />

          {size > 0 && (
            <View style={styles.layer}>
              <View
                style={[styles.surround, { top: centre - size / 2 - rim, width: size + rim * 2, height: size + rim * 2, borderRadius: size / 2 + rim, borderWidth: rim }]}
              />
              <View style={[styles.circle, { top: centre - size / 2, width: size, height: size, borderRadius: size / 2, borderWidth: strong ? 8 : 3 }]} />

              {/* Adding a face: the ring of marks. A mark that is done is longer and thicker, not only darker. */}
              {purpose === 'enrolSweep' && (
                <View style={[styles.anchor, { top: centre }]}>
                  {Array.from({ length: TICKS }, (_, index) => {
                    const angle = (index * 360) / TICKS;
                    const filled = got.includes(sideOf(angle));
                    const width = filled ? 5 : 3;
                    const height = filled ? 22 : 10;
                    return (
                      <View
                        key={index}
                        style={[
                          styles.tick,
                          { width, height, borderRadius: width / 2, top: -height / 2, start: -width / 2, opacity: filled ? 1 : 0.35 },
                          // Turned about the middle of the circle, then pushed out to its edge. Angles are of the
                          // screen itself, so the ring is not mirrored in Urdu: it follows the person's head.
                          { transform: [{ rotate: `${angle}deg` }, { translateY: -(size / 2 + 22) }] },
                        ]}
                      />
                    );
                  })}
                </View>
              )}

              {/* The lock: a tick on the edge of the circle, as well as the thicker line and the word above. */}
              {strong && (
                <View style={[styles.badge, { top: centre + size / 2 - 22 }]}>
                  <Ionicons name="checkmark" size={30} color="#FFFFFF" />
                </View>
              )}
            </View>
          )}

          <View style={[styles.column, { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.three }]}>
            <View accessibilityLiveRegion="polite">
              <ThemedText type="subtitle" style={styles.line}>
                {line}
              </ThemedText>
            </View>

            {/* Nothing is drawn here: this is the room the circle sits in, and the face must stay uncovered. */}
            <View style={styles.space} onLayout={(event) => setSpace({ y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })} />

            <View style={styles.controls}>
              <View style={styles.status}>
                {!ready || finished ? (
                  <ActivityIndicator size="large" color={INK} />
                ) : purpose === 'enrolSweep' ? (
                  // Progress in words as well as on the ring.
                  <ThemedText type="subtitle" style={styles.ink}>
                    {t('face.sweep.progress', { done: got.length, total: ALL_POSES.length })}
                  </ThemedText>
                ) : null}
              </View>
              {manual && !locked && <Button variant="secondary" icon="camera-outline" label={t('face.track.manual')} onPress={() => void takeNow()} />}
              {/* The detector has seen nothing usable in all this time: offer the plain way. */}
              {purpose === 'enrolSweep' && late && got.length === 0 && !finished && (
                <Button variant="secondary" icon="camera-outline" label={t('face.sweep.oneByOne')} onPress={giveUp} />
              )}
              <Button variant="secondary" label={t('common.cancel')} disabled={finished} onPress={onCancel} />
            </View>
          </View>
        </DirectionView>
      ) : (
        <DirectionView
          style={[styles.panelRoot, { backgroundColor: theme.background, paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]}
          accessibilityLabel={label}>
          <View style={styles.panel}>
            {refused ? (
              <>
                <ThemedText type="subtitle" style={styles.panelTitle}>
                  {t('face.cameraNeeded')}
                </ThemedText>
                {permission?.canAskAgain ? (
                  <Button icon="camera-outline" label={t('common.retry')} onPress={() => void requestPermission().catch(() => undefined)} />
                ) : (
                  // Android stops asking after two refusals; from then on only the phone's settings can allow it.
                  <Button icon="settings-outline" label={t('push.openSettings')} onPress={() => void Linking.openSettings().catch(() => undefined)} />
                )}
              </>
            ) : (
              // Waiting for the phone to say whether the camera is allowed, or for the person to answer.
              <>
                <ActivityIndicator size="large" color={theme.primary} />
                <ThemedText type="default" themeColor="textSecondary" style={styles.centre}>
                  {t('face.openingCamera')}
                </ThemedText>
              </>
            )}
            <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
          </View>
        </DirectionView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  // Centred by the row, never by `left`, so it is the same in Urdu.
  layer: { ...StyleSheet.absoluteFill, alignItems: 'center', overflow: 'hidden', pointerEvents: 'none' },
  surround: { position: 'absolute', borderColor: SURROUND },
  circle: { position: 'absolute', borderColor: INK },
  // A point at the middle of the circle; the marks are placed round it.
  anchor: { position: 'absolute', width: 0, height: 0 },
  tick: { position: 'absolute', backgroundColor: INK },
  badge: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  column: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four },
  // Readable at arm's length: the phone is often propped up or held by someone else.
  line: { textAlign: 'center', fontSize: 28, lineHeight: 36, color: INK, minHeight: 72 },
  space: { flex: 1, minHeight: 200 },
  controls: { gap: Spacing.two },
  status: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ink: { textAlign: 'center', color: INK },
  panelRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  panel: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  panelTitle: { textAlign: 'center', fontSize: 24, lineHeight: 32 },
  centre: { textAlign: 'center' },
});
