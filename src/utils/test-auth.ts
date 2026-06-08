/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import http from 'http';
import mongoose from 'mongoose';
import app from '../app';
import { User } from '../models/user.model';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { WorkspaceRole, WorkspaceType } from '../models/types';
import { requireWorkspaceRole } from '../middleware/rbac';
import { authenticateJWT } from '../middleware/auth';

const TEST_PORT = 3001;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Mount a dummy test route to verify RBAC middleware
app.get(
  '/test-rbac/:workspaceId',
  authenticateJWT,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  (req, res) => {
    res.status(200).json({ success: true, membership: req.membership });
  },
);

async function runAuthTests() {
  console.log('--- Phase 3 Authentication & Authorization Validation ---');

  // Start server locally for tests
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`Test server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupWorkspaceIds: mongoose.Types.ObjectId[] = [];

  try {
    const uniqueSuffix = Date.now();
    const testUserEmail = `auth-test-${uniqueSuffix}@cloudvault.com`;
    const testUsername = `testuser_${uniqueSuffix}`;
    const testPassword = 'securePassword123';

    // 1. Test registration validation failures
    console.log('Testing registration validation checks...');
    const registerFailRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid-email',
        username: 'ab',
        password: '123',
      }),
    });
    if (registerFailRes.status !== 400) {
      throw new Error(`Register validation check failed, status is: ${registerFailRes.status}`);
    }
    const failData = (await registerFailRes.json()) as any;
    console.log('Validation checked passed. Caught errors:', JSON.stringify(failData.errors));

    // 2. Test successful registration
    console.log('Testing successful registration...');
    const registerRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        username: testUsername,
        password: testPassword,
      }),
    });
    if (registerRes.status !== 201) {
      const errText = await registerRes.text();
      throw new Error(`Registration failed with status ${registerRes.status}: ${errText}`);
    }
    const registeredUser = (await registerRes.json()) as any;
    cleanupUserIds.push(new mongoose.Types.ObjectId(registeredUser._id));
    console.log('Successfully registered user:', registeredUser.name);

    // 3. Test duplicate email registration
    console.log('Testing duplicate email check...');
    const registerDupRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        username: 'otherName',
        password: 'somePassword',
      }),
    });
    if (registerDupRes.status !== 400) {
      throw new Error(`Duplicate registration succeeded with status: ${registerDupRes.status}`);
    }
    const dupErr = (await registerDupRes.json()) as any;
    console.log('Duplicate check passed. Message:', dupErr.error);

    // 4. Test login failure
    console.log('Testing login incorrect credentials check...');
    const loginFailRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: 'wrongPassword',
      }),
    });
    if (loginFailRes.status !== 401) {
      throw new Error(`Login failed to reject wrong credentials. Status: ${loginFailRes.status}`);
    }
    console.log('Incorrect login password successfully rejected.');

    // 5. Test login success & HttpOnly cookie headers
    console.log('Testing login success & cookie header issuance...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
      }),
    });
    if (loginRes.status !== 200) {
      throw new Error(`Login failed with status ${loginRes.status}`);
    }

    const cookieHeader = loginRes.headers.get('set-cookie');
    if (!cookieHeader || !cookieHeader.includes('token=')) {
      throw new Error('Login response missing cookie token header');
    }
    if (!cookieHeader.includes('HttpOnly')) {
      throw new Error('Cookie is not configured as HttpOnly!');
    }
    console.log('Successfully logged in. Token cookie generated as HttpOnly.');

    // Extract token string from cookie header
    const tokenCookie = cookieHeader.split(';')[0];

    // 6. Test GET /auth/me without token
    console.log('Testing GET /auth/me without token (expects 401)...');
    const meFailRes = await fetch(`${BASE_URL}/auth/me`);
    if (meFailRes.status !== 401) {
      throw new Error(`Protected route returned status ${meFailRes.status} instead of 401`);
    }
    console.log('Protected route successfully rejected request without cookie.');

    // 7. Test GET /auth/me with token cookie
    console.log('Testing GET /auth/me with token cookie (expects 200)...');
    const meRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Cookie: tokenCookie },
    });
    if (meRes.status !== 200) {
      const errMe = await meRes.text();
      throw new Error(`Protected route returned status ${meRes.status}: ${errMe}`);
    }
    const meData = (await meRes.json()) as any;
    if (meData.email !== testUserEmail.toLowerCase()) {
      throw new Error(`Returned email mismatch. Expected: ${testUserEmail}, got: ${meData.email}`);
    }
    console.log('Successfully accessed GET /auth/me. Returned user info:', meData.name);

    // 8. Setup RBAC workspace elements for authorization checks
    console.log('Setting up mock workspace for RBAC verification...');
    const testWorkspace = await Workspace.create({
      name: 'Auth Test Workspace',
      ownerId: registeredUser._id,
      type: WorkspaceType.PERSONAL,
      aiEnabled: false,
    });
    cleanupWorkspaceIds.push(testWorkspace._id as mongoose.Types.ObjectId);

    // Create a workspace membership for the user
    const membership = await WorkspaceMember.create({
      workspaceId: testWorkspace._id,
      userId: registeredUser._id,
      role: WorkspaceRole.VIEWER, // Start with VIEWER role (insufficient for required role ADMIN)
    });

    // 9. Test RBAC validation rejection (VIEWER trying to access ADMIN route)
    console.log('Testing RBAC rejection (VIEWER accessing ADMIN route, expects 403)...');
    const rbacFailRes = await fetch(`${BASE_URL}/test-rbac/${testWorkspace._id}`, {
      headers: { Cookie: tokenCookie },
    });
    if (rbacFailRes.status !== 403) {
      throw new Error(`RBAC failed to reject VIEWER. Status: ${rbacFailRes.status}`);
    }
    const rbacFailData = (await rbacFailRes.json()) as any;
    console.log('RBAC successfully blocked VIEWER. Error:', rbacFailData.error);

    // 10. Test RBAC validation approval (Promote to ADMIN and try again)
    console.log('Promoting user to ADMIN role...');
    membership.role = WorkspaceRole.ADMIN;
    await membership.save();

    console.log('Testing RBAC approval (ADMIN accessing ADMIN route, expects 200)...');
    const rbacPassRes = await fetch(`${BASE_URL}/test-rbac/${testWorkspace._id}`, {
      headers: { Cookie: tokenCookie },
    });
    if (rbacPassRes.status !== 200) {
      const errRbac = await rbacPassRes.text();
      throw new Error(`RBAC rejected ADMIN. Status: ${rbacPassRes.status}: ${errRbac}`);
    }
    const rbacPassData = (await rbacPassRes.json()) as any;
    if (!rbacPassData.success) {
      throw new Error('RBAC response indicated failure');
    }
    console.log(
      'RBAC successfully approved ADMIN access. Role verified:',
      rbacPassData.membership.role,
    );

    // 11. Test Logout
    console.log('Testing logout...');
    const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: tokenCookie },
    });
    if (logoutRes.status !== 200) {
      throw new Error(`Logout returned status ${logoutRes.status}`);
    }
    const logoutCookieHeader = logoutRes.headers.get('set-cookie');
    if (!logoutCookieHeader || !logoutCookieHeader.includes('token=;')) {
      throw new Error('Logout did not clear cookie token header');
    }
    console.log('Successfully logged out. Token cookie cleared.');

    console.log('\n--- All Phase 3 Authentication & Authorization checks passed! ---');
  } catch (error) {
    console.error('Phase 3 verification error encountered:', error);
    process.exitCode = 1;
  } finally {
    console.log('\nCleaning up mock authentication documents...');
    await WorkspaceMember.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    await Workspace.deleteMany({ _id: { $in: cleanupWorkspaceIds } });
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    console.log('Cleanup complete.');

    // Close the HTTP server
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('Test server closed.');
        resolve();
      });
    });
  }
}

// Ensure mongoose connection is ready
if (mongoose.connection.readyState === 1) {
  runAuthTests();
} else {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://0.0.0.0/cloudVault-drive';
  mongoose.connect(MONGO_URI).then(() => runAuthTests());
}
