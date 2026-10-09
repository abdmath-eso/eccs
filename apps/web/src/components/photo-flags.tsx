import { describePhotoFlag, type PhotoFlagDto } from "@eccs/shared";

/**
 * Why a proof photo is doubtful, in words, for ECCS staff: "Same photo as on
 * 3 Oct, Opening checklist", "Taken 2.1 km from the outlet", "Phone clock was
 * 3 hours ahead", "Location looks faked". Shown under or beside the photo.
 *
 * A mark and the words carry the meaning, never colour alone. A reason with no
 * innocent explanation (the identical file used again, a location the phone
 * says is faked) is written in bold; the others are signs worth a look. A
 * photo with nothing against it shows nothing at all.
 */
export function PhotoFlags({ flags, className = "" }: { flags: readonly PhotoFlagDto[] | undefined; className?: string }) {
  if (!flags || flags.length === 0) return null;
  return (
    <ul className={`flex flex-col gap-0.5 text-sm ${className}`} aria-label="Why this photo is doubtful">
      {flags.map((flag) => (
        <li key={flag.code} className="flex items-start gap-1.5">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none ${
              flag.certain ? "bg-danger text-white" : "border border-foreground text-foreground"
            }`}>
            {flag.certain ? "!" : "?"}
          </span>
          <span className={flag.certain ? "font-semibold" : ""}>{describePhotoFlag(flag)}</span>
        </li>
      ))}
    </ul>
  );
}
