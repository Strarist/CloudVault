import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // Protected routes require token cookie presence
  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Allow /login?switch=1 so the client can sign out and show the login form
  const isSwitchAccount =
    pathname.startsWith('/login') && request.nextUrl.searchParams.get('switch') === '1';

  // Auth pages (login, register) should redirect to dashboard if token exists
  if ((pathname.startsWith('/login') || pathname.startsWith('/register')) && !isSwitchAccount) {
    if (token) {
      const dashboardUrl = new URL('/dashboard', request.url);
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
