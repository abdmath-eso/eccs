import { ECCS_STATE_CODE } from '@eccs/shared';

// ECCS as it is printed on a tax invoice: the supplier.
//
// SAMPLE DETAILS. The legal name, the address and above all the GSTIN are made
// up until the founder supplies the real ones (docs/STATUS.md, "Before the
// pilot goes live"). A real invoice must not be issued with them. The trading
// name and city are the ones the other PDFs print in their header.
export const SUPPLIER = {
  name: 'ECCS',
  legalName: 'Eosfera Commercial Cleaning Services',
  address: 'Sample address: 1st Floor, Road No. 1, Banjara Hills, Hyderabad, Telangana 500034',
  gstin: '36AAECE0000A1Z0',
  stateCode: ECCS_STATE_CODE,
  /** Printed beside the GSTIN and address so nobody mistakes them for real ones. */
  isSample: true,
} as const;
