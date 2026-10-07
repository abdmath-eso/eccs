// The app's main sections. They show the bottom bar; screens opened from them do not.
const TAB_ROUTES = ['/', '/checklists', '/support', '/services', '/sops'];

/** True for the top-level screens that the bottom bar switches between. */
export const isTabRoute = (pathname: string) => TAB_ROUTES.includes(pathname.replace(/\/$/, '') || '/');
