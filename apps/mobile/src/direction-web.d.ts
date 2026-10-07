// React Native for Web ships no type descriptions for this internal file.
// Used only by components/direction-view.web.tsx.
declare module 'react-native-web/dist/modules/useLocale' {
  import type { ReactNode } from 'react';

  export function LocaleProvider(props: {
    direction?: 'ltr' | 'rtl';
    locale?: string;
    children: ReactNode;
  }): ReactNode;
}
