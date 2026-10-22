import type Ionicons from '@expo/vector-icons/Ionicons';
import type { IssueStatus } from '@eccs/shared';

import { StatusChip, type StatusTone } from '@/components/ui/status-chip';
import { useSession } from '@/lib/session';

// An icon goes with each colour, so the stage does not rely on colour alone.
const LOOK: Record<IssueStatus, { tone: StatusTone; icon: keyof typeof Ionicons.glyphMap }> = {
  OPEN: { tone: 'bad', icon: 'alert' },
  IN_PROGRESS: { tone: 'info', icon: 'time-outline' },
  RESOLVED: { tone: 'good', icon: 'checkmark' },
  CLOSED: { tone: 'neutral', icon: 'lock-closed' },
};

/** Where an ECCS support issue stands. */
export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const { t } = useSession();
  return <StatusChip {...LOOK[status]} label={t(`issueStatus.${status}`)} />;
}
