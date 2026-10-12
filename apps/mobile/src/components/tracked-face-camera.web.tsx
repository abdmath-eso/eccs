// The browser preview's version of tracked-face-camera.tsx: nothing.
//
// The camera that follows the face is made of native parts that exist only in
// the installed app. This empty stand-in keeps them out of the browser build
// altogether; face-capture.tsx never shows it (it uses the countdown camera in
// a browser).

export function TrackedFaceCamera(_props: { purpose: 'clock' | 'enrolSweep'; onCancel: () => void; onUnavailable: () => void }) {
  return null;
}
