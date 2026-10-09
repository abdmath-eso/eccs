import { Platform } from 'react-native';

import { OptionSheet, type SheetOption } from '@/components/ui/option-sheet';
import type { PrintRoute } from '@/lib/label-print';
import { useSession } from '@/lib/session';

interface LabelPrintSheetProps {
  visible: boolean;
  /**
   * True when every sticker wanted is the same label. A picture holds one
   * label, so that way out is offered only then.
   */
  oneKind: boolean;
  onClose: () => void;
  /** Told which way was chosen, once the sheet has closed. The screen then saves the labels and sends them that way. */
  onChoose: (route: PrintRoute) => void;
  /** An extra choice at the end, such as the label size. It too runs once the sheet has closed. */
  extra?: SheetOption;
}

// An iPhone will not open the print or share screen, or another pop-up, while this one is still closing.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 500 : 0;

/**
 * The ways to get labels out of the phone, as a list to choose from: the
 * phone's own print screen, an A4 sheet for an ordinary printer, or the label
 * as a picture or PDF handed to another app (a label printer's own app).
 */
export function LabelPrintSheet({ visible, oneKind, onClose, onChoose, extra }: LabelPrintSheetProps) {
  const { t } = useSession();

  function later(action: () => void) {
    onClose();
    setTimeout(action, AFTER_SHEET_MS);
  }

  const options: SheetOption[] = [
    { label: t('labels.print.system'), icon: 'print-outline', onPress: () => later(() => onChoose('SYSTEM')) },
    { label: t('labels.print.sheet'), icon: 'grid-outline', onPress: () => later(() => onChoose('SHEET')) },
    ...(oneKind
      ? [{ label: t('labels.print.image'), icon: 'image-outline' as const, onPress: () => later(() => onChoose('IMAGE')) }]
      : []),
    { label: t('labels.print.pdf'), icon: 'document-outline', onPress: () => later(() => onChoose('PDF')) },
    ...(extra ? [{ ...extra, onPress: () => later(extra.onPress) }] : []),
  ];

  return <OptionSheet visible={visible} title={t('labels.print.title')} options={options} onClose={onClose} />;
}
