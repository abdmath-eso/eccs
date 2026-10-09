import { Platform } from 'react-native';

import { OptionSheet, type SheetOption } from '@/components/ui/option-sheet';
import { sendLabels, type PrintJob, type PrintOutcome, type PrintRoute } from '@/lib/label-print';
import { useSession } from '@/lib/session';

interface LabelPrintSheetProps {
  /** The labels to print; null keeps the sheet closed. */
  job: PrintJob | null;
  onClose: () => void;
  /** Told how it went, so the screen can say so and note that the label was printed. */
  onResult: (outcome: PrintOutcome, route: PrintRoute) => void;
  /** An extra choice at the end, such as "Save without printing". */
  extra?: SheetOption;
}

// An iPhone will not open the print or share screen while a pop-up is still closing.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 500 : 0;

/**
 * The ways to get a label out of the phone, as a list to choose from: the
 * phone's own print screen, an A4 sheet for an ordinary printer, or the label
 * as a picture or PDF handed to another app (a label printer's own app).
 */
export function LabelPrintSheet({ job, onClose, onResult, extra }: LabelPrintSheetProps) {
  const { t, api } = useSession();

  function choose(route: PrintRoute) {
    if (!job) return;
    onClose();
    setTimeout(() => {
      sendLabels(job, route, api)
        .then((outcome) => onResult(outcome, route))
        .catch(() => onResult('unavailable', route));
    }, AFTER_SHEET_MS);
  }

  const options: SheetOption[] = [
    { label: t('labels.print.system'), icon: 'print-outline', onPress: () => choose('SYSTEM') },
    { label: t('labels.print.sheet'), icon: 'grid-outline', onPress: () => choose('SHEET') },
    { label: t('labels.print.image'), icon: 'image-outline', onPress: () => choose('IMAGE') },
    { label: t('labels.print.pdf'), icon: 'document-outline', onPress: () => choose('PDF') },
    ...(extra ? [extra] : []),
  ];

  return <OptionSheet visible={job !== null} title={t('labels.print.title')} options={options} onClose={onClose} />;
}
