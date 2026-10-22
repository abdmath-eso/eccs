import type { ChecklistRunStatus } from '@eccs/shared';

import { StatusChip } from '@/components/ui/status-chip';
import { useSession } from '@/lib/session';

/**
 * A checklist's state. `overdue` (not handed in and past its due time) shows as a red "Overdue"
 * label instead of "Not started" or "In progress", in place of the red clock icon used until
 * 22 Oct 2026, which read as a letter "L" and gave the state as a picture alone.
 */
export function StatusBadge({
  status,
  reviewed,
  overdue,
}: {
  status: ChecklistRunStatus;
  reviewed?: boolean;
  overdue?: boolean;
}) {
  const { t } = useSession();
  if (overdue && (status === 'PENDING' || status === 'IN_PROGRESS'))
    return <StatusChip tone="bad" icon="alarm-outline" label={t('checklists.overdue')} />;
  if (status === 'SUBMITTED')
    return <StatusChip tone="good" icon="checkmark" label={reviewed ? t('status.reviewed') : t('status.SUBMITTED')} />;
  if (status === 'MISSED') return <StatusChip tone="bad" icon="alert" label={t('status.MISSED')} />;
  return (
    <StatusChip
      tone={status === 'IN_PROGRESS' ? 'info' : 'neutral'}
      icon={status === 'IN_PROGRESS' ? 'ellipsis-horizontal' : 'ellipse-outline'}
      label={t(`status.${status}`)}
    />
  );
}
