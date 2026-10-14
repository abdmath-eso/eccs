import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_TERMS = 'legal:allowWithoutTerms';

/**
 * Lets a logged-in restaurant user reach an endpoint before they have agreed to
 * the Terms of Service and Privacy Policy. Only for what the app needs to log in
 * and out and to show the acceptance screen: everything else is refused with
 * TERMS_NOT_ACCEPTED until they agree (see LegalGate).
 */
export const AllowWithoutTerms = () => SetMetadata(ALLOW_WITHOUT_TERMS, true);
