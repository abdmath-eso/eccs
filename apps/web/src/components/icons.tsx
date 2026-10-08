import type { ReactNode } from "react";

// The console's icons: simple line drawings kept here as inline SVG, so no
// icon package has to be installed for a dozen pictures. Each is decoration
// beside a written label (or a hidden one, when the menu is collapsed), so all
// are hidden from screen readers.

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** A heartbeat line: Monitoring. */
export const MonitoringIcon = () => (
  <Icon>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Icon>
);

/** A calendar with a tick: Visits. */
export const VisitsIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18M9 15.5l2 2 4-4" />
  </Icon>
);

/** A clipboard with a tick: Inspections. */
export const InspectionsIcon = () => (
  <Icon>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 14l2 2 4-4" />
  </Icon>
);

/** A speech bubble with an exclamation mark: Issues. */
export const IssuesIcon = () => (
  <Icon>
    <path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1zM12 7.5v3.5M12 13.5v.01" />
  </Icon>
);

/** A building: Clients. */
export const ClientsIcon = () => (
  <Icon>
    <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M2 21h20M8 8h2M8 12h2M8 16h2" />
  </Icon>
);

/** A page with lines: Licences. */
export const LicencesIcon = () => (
  <Icon>
    <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 12h6M9 16h6" />
  </Icon>
);

/** A rosette: Certificates. */
export const CertificatesIcon = () => (
  <Icon>
    <circle cx="12" cy="9" r="5" />
    <path d="M9 13.5 7.5 21l4.5-2.5 4.5 2.5-1.5-7.5" />
  </Icon>
);

/** A till receipt: Invoices. */
export const InvoicesIcon = () => (
  <Icon>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
  </Icon>
);

/** Two arrows going round: Plans, which repeat every cycle. */
export const PlansIcon = () => (
  <Icon>
    <path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />
  </Icon>
);

/** A price tag: Catalogue. */
export const CatalogueIcon = () => (
  <Icon>
    <path d="M3 5v6l9 9 7-7-9-9H4a1 1 0 0 0-1 1zM7.5 8.5v.01" />
  </Icon>
);

/** A book: SOPs. */
export const SopsIcon = () => (
  <Icon>
    <path d="M5 4h13a1 1 0 0 1 1 1v15H6.5A1.5 1.5 0 0 1 5 18.5zM5 18.5A1.5 1.5 0 0 1 6.5 17H19M9 8h6M9 12h4" />
  </Icon>
);

export const BellIcon = () => (
  <Icon size={22}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Icon>
);

/** Three lines: opens the menu on a narrow window. */
export const MenuIcon = () => (
  <Icon size={22}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon size={22}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

/** A panel with an arrow: narrows the side menu to icons, or widens it again when `flipped`. */
export const CollapseIcon = ({ flipped }: { flipped: boolean }) => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d={flipped ? "M9 4v16M13 10l2 2-2 2" : "M9 4v16M16 10l-2 2 2 2"} />
  </Icon>
);
