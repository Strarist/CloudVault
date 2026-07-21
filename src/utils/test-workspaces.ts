/* eslint-disable no-console, no-inner-declarations, @typescript-eslint/no-explicit-any */
import http from 'http';
import mongoose from 'mongoose';
import app from '../app';
import { User } from '../models/user.model';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { WorkspaceRole, WorkspaceType } from '../models/types';

const TEST_PORT = 3002;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runWorkspaceTests() {
  console.log('--- Phase 5 Workspace System Validation ---');

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
    const emailA = `user-a-${uniqueSuffix}@cloudvault.com`;
    const emailB = `user-b-${uniqueSuffix}@cloudvault.com`;
    const emailC = `user-c-${uniqueSuffix}@cloudvault.com`;
    const password = 'securePassword123';

    // Helper for register
    async function registerUser(email: string, username: string) {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });
      if (res.status !== 201) {
        throw new Error(`Register failed for ${username}: ${await res.text()}`);
      }
      const data = (await res.json()) as any;
      cleanupUserIds.push(new mongoose.Types.ObjectId(data._id));
      return data;
    }

    // Helper for login
    async function loginUser(username: string) {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status !== 200) {
        throw new Error(`Login failed for ${username}: ${await res.text()}`);
      }
      const cookies = res.headers.get('set-cookie') || '';
      const tokenCookie = cookies.split(';')[0];
      const data = (await res.json()) as any;
      return { user: data.user, cookie: tokenCookie };
    }

    // 1. Register users
    console.log('Registering test users A, B, and C...');
    const userA = await registerUser(emailA, `usera_${uniqueSuffix}`);
    const userB = await registerUser(emailB, `userb_${uniqueSuffix}`);
    const userC = await registerUser(emailC, `userc_${uniqueSuffix}`);

    // Logins
    const sessionA = await loginUser(userA.email);
    const sessionB = await loginUser(userB.email);

    // 2. Verify auto-created PERSONAL workspace for User A
    console.log('Verifying auto-created Personal Workspace for User A...');
    const workspacesARes = await fetch(`${BASE_URL}/workspaces`, {
      headers: { Cookie: sessionA.cookie },
    });
    if (workspacesARes.status !== 200) {
      throw new Error(`Failed to list workspaces for A: ${await workspacesARes.text()}`);
    }
    const workspacesA = (await workspacesARes.json()) as any[];
    if (workspacesA.length !== 1) {
      throw new Error(`Expected User A to have exactly 1 workspace, found: ${workspacesA.length}`);
    }
    const personalWS = workspacesA[0];
    if (
      personalWS.role !== WorkspaceRole.OWNER ||
      personalWS.workspaceId.type !== WorkspaceType.PERSONAL
    ) {
      throw new Error(`Invalid personal workspace metadata: ${JSON.stringify(personalWS)}`);
    }
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(personalWS.workspaceId._id));
    console.log('Personal Workspace auto-created successfully:', personalWS.workspaceId.name);

    // 3. Create a TEAM workspace
    console.log('Creating a TEAM workspace...');
    const createWSRes = await fetch(`${BASE_URL}/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ name: 'Engineering Team', description: 'Core dev channel' }),
    });
    if (createWSRes.status !== 201) {
      throw new Error(`Failed to create team workspace: ${await createWSRes.text()}`);
    }
    const teamWSData = (await createWSRes.json()) as any;
    const teamWSId = teamWSData.workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(teamWSId));
    console.log('Created Team Workspace:', teamWSData.workspace.name);

    // 4. Verify list workspaces contains both
    const workspacesA2Res = await fetch(`${BASE_URL}/workspaces`, {
      headers: { Cookie: sessionA.cookie },
    });
    const workspacesA2 = (await workspacesA2Res.json()) as any[];
    if (workspacesA2.length !== 2) {
      throw new Error(`Expected User A to have 2 workspaces, found: ${workspacesA2.length}`);
    }
    console.log('List workspaces count verified: 2');

    // 5. Add User B to TEAM workspace as EDITOR
    console.log('Adding User B to TEAM workspace as EDITOR...');
    const addBRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ email: userB.email, role: WorkspaceRole.EDITOR }),
    });
    if (addBRes.status !== 201) {
      throw new Error(`Failed to add User B: ${await addBRes.text()}`);
    }
    console.log('User B added successfully.');

    // 6. Add User C to TEAM workspace as VIEWER
    console.log('Adding User C to TEAM workspace as VIEWER...');
    const addCRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ email: userC.email, role: WorkspaceRole.VIEWER }),
    });
    if (addCRes.status !== 201) {
      throw new Error(`Failed to add User C: ${await addCRes.text()}`);
    }
    console.log('User C added successfully.');

    // 7. Verify that User B (EDITOR) cannot invite other members (requires ADMIN or OWNER)
    console.log('Testing invite permission rejection for EDITOR role...');
    const failInviteRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionB.cookie,
      },
      body: JSON.stringify({ email: 'somebody@example.com', role: WorkspaceRole.VIEWER }),
    });
    if (failInviteRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for EDITOR invite, got: ${failInviteRes.status}`);
    }
    console.log('Invite permission check verified: Blocked EDITOR.');

    // 8. Verify that User B (EDITOR) cannot modify User C's role
    console.log('Testing role edit permission rejection for EDITOR role...');
    const failRoleUpdateRes = await fetch(
      `${BASE_URL}/workspaces/${teamWSId}/members/${userC._id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionB.cookie,
        },
        body: JSON.stringify({ role: WorkspaceRole.EDITOR }),
      },
    );
    if (failRoleUpdateRes.status !== 403) {
      throw new Error(
        `Expected 403 Forbidden for EDITOR role edit, got: ${failRoleUpdateRes.status}`,
      );
    }
    console.log('Role edit permission check verified: Blocked EDITOR.');

    // 9. Update User B's role to ADMIN (by User A, OWNER)
    console.log('Promoting User B to ADMIN role...');
    const promoteBRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members/${userB._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ role: WorkspaceRole.ADMIN }),
    });
    if (promoteBRes.status !== 200) {
      throw new Error(`Failed to promote User B: ${await promoteBRes.text()}`);
    }
    console.log('User B successfully promoted to ADMIN.');

    // 10. Verify User B (ADMIN) can now update User C's role to EDITOR
    console.log('Promoting User C to EDITOR (as User B, ADMIN)...');
    const promoteCRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members/${userC._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionB.cookie,
      },
      body: JSON.stringify({ role: WorkspaceRole.EDITOR }),
    });
    if (promoteCRes.status !== 200) {
      throw new Error(`Failed to promote User C as ADMIN B: ${await promoteCRes.text()}`);
    }
    console.log('User C promoted to EDITOR by ADMIN.');

    // 11. Verify User B (ADMIN) cannot demote or modify User A (OWNER)
    console.log('Testing role edit rejection for OWNER by ADMIN...');
    const failModifyOwnerRes = await fetch(
      `${BASE_URL}/workspaces/${teamWSId}/members/${userA._id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionB.cookie,
        },
        body: JSON.stringify({ role: WorkspaceRole.EDITOR }),
      },
    );
    if (failModifyOwnerRes.status !== 400 && failModifyOwnerRes.status !== 403) {
      throw new Error(
        `Expected 400 or 403 for modifying OWNER by ADMIN, got: ${failModifyOwnerRes.status}`,
      );
    }
    console.log('Role edit check verified: Blocked ADMIN from modifying OWNER.');

    // 12. Verify User B (ADMIN) cannot kick User A (OWNER)
    console.log('Testing remove/kick rejection for OWNER by ADMIN...');
    const failKickOwnerRes = await fetch(
      `${BASE_URL}/workspaces/${teamWSId}/members/${userA._id}`,
      {
        method: 'DELETE',
        headers: { Cookie: sessionB.cookie },
      },
    );
    if (failKickOwnerRes.status !== 403) {
      throw new Error(
        `Expected 403 Forbidden for ADMIN kicking OWNER, got: ${failKickOwnerRes.status}`,
      );
    }
    console.log('Remove check verified: Blocked ADMIN from kicking OWNER.');

    // 13. Kick User C (by User A, OWNER)
    console.log('Kicking User C (as User A, OWNER)...');
    const kickCRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members/${userC._id}`, {
      method: 'DELETE',
      headers: { Cookie: sessionA.cookie },
    });
    if (kickCRes.status !== 200) {
      throw new Error(`Failed to kick User C: ${await kickCRes.text()}`);
    }
    console.log('User C successfully kicked.');

    // 14. Self-leave (User B leaving the workspace)
    console.log('User B leaving the workspace...');
    const leaveWSRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members/${userB._id}`, {
      method: 'DELETE',
      headers: { Cookie: sessionB.cookie },
    });
    if (leaveWSRes.status !== 200) {
      throw new Error(`User B failed to leave workspace: ${await leaveWSRes.text()}`);
    }
    console.log('User B successfully left.');

    // 15. Verify User A (OWNER) cannot leave
    console.log('Verifying OWNER cannot leave workspace...');
    const ownerLeaveWSRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members/${userA._id}`, {
      method: 'DELETE',
      headers: { Cookie: sessionA.cookie },
    });
    if (ownerLeaveWSRes.status !== 400) {
      throw new Error(`Expected 400 Bad Request for OWNER leaving, got: ${ownerLeaveWSRes.status}`);
    }
    console.log('Leave check verified: Blocked OWNER from leaving.');

    // 16. Verify OWNER self-demotion is blocked
    console.log('Verifying OWNER self-demotion is blocked...');
    const demoteOwnerRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members/${userA._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ role: WorkspaceRole.ADMIN }),
    });
    if (demoteOwnerRes.status !== 400) {
      throw new Error(`Expected 400 Bad Request for demoting OWNER, got: ${demoteOwnerRes.status}`);
    }
    console.log('Demotion check verified: Blocked OWNER demotion.');

    // 17. Verify multiple OWNER creation is blocked (via promotion)
    console.log('Verifying promoting a member to OWNER is blocked...');
    const promoteToOwnerRes = await fetch(
      `${BASE_URL}/workspaces/${teamWSId}/members/${userB._id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionA.cookie,
        },
        body: JSON.stringify({ role: WorkspaceRole.OWNER }),
      },
    );
    if (promoteToOwnerRes.status !== 400) {
      throw new Error(
        `Expected 400 Bad Request for promoting to OWNER, got: ${promoteToOwnerRes.status}`,
      );
    }
    console.log('Promote to OWNER check verified: Blocked second OWNER promotion.');

    // 18. Verify inviting a member as OWNER is blocked
    console.log('Verifying inviting a member as OWNER is blocked...');
    const inviteAsOwnerRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ email: userC.email, role: WorkspaceRole.OWNER }),
    });
    if (inviteAsOwnerRes.status !== 400) {
      throw new Error(
        `Expected 400 Bad Request for inviting member as OWNER, got: ${inviteAsOwnerRes.status}`,
      );
    }
    console.log('Invite as OWNER check verified: Blocked second OWNER invitation.');

    // 19. Verify duplicate member invitation returns controlled 400 error
    console.log('Verifying duplicate member invitation returns controlled 400 error...');
    // Add user B back to team workspace first
    await fetch(`${BASE_URL}/workspaces/${teamWSId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ email: userB.email, role: WorkspaceRole.EDITOR }),
    });
    // Attempt duplicate invitation
    const duplicateInviteRes = await fetch(`${BASE_URL}/workspaces/${teamWSId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({ email: userB.email, role: WorkspaceRole.EDITOR }),
    });
    if (duplicateInviteRes.status !== 400) {
      throw new Error(
        `Expected 400 Bad Request for duplicate invitation, got: ${duplicateInviteRes.status}`,
      );
    }
    const duplicateText = (await duplicateInviteRes.json()) as any;
    if (duplicateText.error !== 'User is already a member of this workspace.') {
      throw new Error(
        `Expected controlled validation message, got: ${JSON.stringify(duplicateText)}`,
      );
    }
    console.log('Duplicate invitation check verified: Blocked and returned 400.');

    // 20. Verify inviting a member to a PERSONAL workspace is blocked
    console.log('Verifying inviting a member to a PERSONAL workspace is blocked...');
    const inviteToPersonalRes = await fetch(
      `${BASE_URL}/workspaces/${personalWS.workspaceId._id}/members`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionA.cookie,
        },
        body: JSON.stringify({ email: userB.email, role: WorkspaceRole.EDITOR }),
      },
    );
    if (inviteToPersonalRes.status !== 400) {
      throw new Error(
        `Expected 400 Bad Request for inviting to Personal workspace, got: ${inviteToPersonalRes.status}`,
      );
    }
    const personalInviteText = (await inviteToPersonalRes.json()) as any;
    if (personalInviteText.error !== 'Cannot add members to a Personal Workspace.') {
      throw new Error(
        `Expected Personal workspace error message, got: ${JSON.stringify(personalInviteText)}`,
      );
    }
    console.log('Personal workspace invitation check verified: Blocked and returned 400.');

    console.log('\n--- All Phase 5 Workspace System checks passed! ---');
  } catch (error) {
    console.error('Test validation failed with error:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up mock test documents...');
    // Drop mock test users, workspaces, and workspace members created
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    await Workspace.deleteMany({ _id: { $in: cleanupWorkspaceIds } });
    await WorkspaceMember.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    console.log('Cleanup complete.');

    // Close server
    server.close(() => {
      console.log('Test server closed.');
      process.exit(0);
    });
  }
}

// Ensure MongoDB is connected
if (mongoose.connection.readyState === 0) {
  const mongoUri = process.env.MONGO_URI || 'mongodb://0.0.0.0/cloudVault-drive';
  mongoose.connect(mongoUri).then(() => {
    runWorkspaceTests();
  });
} else {
  runWorkspaceTests();
}
